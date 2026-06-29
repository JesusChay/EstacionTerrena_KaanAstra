const { KalmanFilter } = require('../../domain/telemetry/kalmanFilter');
const { Quaternion } = require('../../domain/telemetry/quaternion');
const { calculateDistance, normalizeRawSensorUnits } = require('../../domain/telemetry/telemetryMath');
const { getChannelState, mergeTelemetrySources } = require('../../domain/telemetry/telemetryMerge');

function createTelemetryProcessor({
    parseTelemetryMessage,
    now = () => new Date(),
    debugLogger = () => {},
    warnLogger = () => {},
    infoLogger = () => {},
    initialReceiverLocation = {}
} = {}) {
    let payloadSensors = sanitizeReceiverLocation(initialReceiverLocation);
    let lastPayloadTime = null;
    let lastPayloadUpdateTime = null;
    let lastPayloadPosition = null;
    let accelBias = { x: 0, y: 0, z: 0 };
    let calibrationSamples = [];
    let payloadSources = {
        lora: {},
        xbee: {},
        unknown: {}
    };
    let payloadKalman = null;
    let payloadOrientation = new Quaternion(1, 0, 0, 0);
    let peakAltitude = null;

    function process(message) {
        let rawParsed;
        if (typeof message === 'object' && message !== null) {
            rawParsed = message;
        } else if (typeof message === 'string') {
            rawParsed = parseTelemetryMessage(message);
        }

        if (!rawParsed) {
            warnLogger(`⚠️ No se pudo interpretar la linea serial: ${message}`);
            return null;
        }

        debugLogger('PARSED_RAW', rawParsed);
        const parsed = normalizeRawSensorUnits(rawParsed);
        debugLogger('PARSED_NORMALIZED', parsed);

        const sourceChannel = parsed.sourceChannel || 'unknown';
        const accelerationValidation = validateAcceleration(parsed);
        if (!accelerationValidation.ok) {
            warnLogger(accelerationValidation.message, accelerationValidation.details);
            return null;
        }

        const sourceState = getChannelState(payloadSources, sourceChannel);
        for (const [key, value] of Object.entries(parsed)) {
            if (value !== undefined) {
                sourceState[key] = value;
            }
        }
        sourceState.sourceChannel = sourceChannel;

        payloadSensors = {
            ...payloadSensors,
            ...mergeTelemetrySources({
                preferredSource: sourceChannel,
                payloadSources,
                fallbackState: payloadSensors
            })
        };

        const gpsLat = payloadSensors.latitude;
        const gpsLon = payloadSensors.longitude;
        const hasUsableGpsFix = Number.isFinite(gpsLat) && Number.isFinite(gpsLon) && gpsLat !== 0 && gpsLon !== 0;

        if (!hasUsableGpsFix && lastPayloadPosition) {
            payloadSensors.latitude = lastPayloadPosition.latitude;
            payloadSensors.longitude = lastPayloadPosition.longitude;
        }

        const currentTime = now();

        const {
            speed,
            temperature,
            pressure,
            accelx,
            accely,
            accelz,
            gyrox,
            gyroy,
            gyroz,
            magx,
            magy,
            magz,
            altitude,
            latitude,
            longitude,
            receiverLatitude,
            receiverLongitude
        } = payloadSensors;

        let correctedAccelx;
        let correctedAccely;
        let correctedAccelz;
        if (Number.isFinite(accelx) && Number.isFinite(accely) && Number.isFinite(accelz)) {
            calibrateAccelerometer(accelx, accely, accelz);
            correctedAccelx = accelx - accelBias.x;
            correctedAccely = accely - accelBias.y;
            correctedAccelz = accelz - accelBias.z;
        }

        let velocity = 0;
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            if (lastPayloadPosition) {
                const distance = calculateDistance(
                    lastPayloadPosition.latitude,
                    lastPayloadPosition.longitude,
                    latitude,
                    longitude
                );
                const deltaTime = lastPayloadTime ? Math.min((currentTime - lastPayloadTime) / 1000, 1) : 0.5;
                velocity = deltaTime > 0 ? distance / deltaTime : 0;
            }
            lastPayloadPosition = { latitude, longitude };
        }

        let distanceToReceiver = payloadSensors.distanceToReceiver;
        if (Number.isFinite(latitude) && Number.isFinite(longitude) && Number.isFinite(receiverLatitude) && Number.isFinite(receiverLongitude)) {
            distanceToReceiver = calculateDistance(receiverLatitude, receiverLongitude, latitude, longitude);
        }

        const altitudeState = updateAltitudeState({
            altitude,
            correctedAccelx,
            correctedAccely,
            correctedAccelz,
            gyrox,
            gyroy,
            gyroz,
            magx,
            magy,
            magz,
            currentTime
        });

        if (lastPayloadUpdateTime && (currentTime - lastPayloadUpdateTime) / 1000 > 10) {
            if (payloadKalman) {
                payloadKalman.reset();
            }
            if (Number.isFinite(correctedAccelx) && Number.isFinite(correctedAccely) && Number.isFinite(correctedAccelz)) {
                payloadOrientation = Number.isFinite(magx)
                    ? Quaternion.fromAccelAndMag(correctedAccelx, correctedAccely, correctedAccelz, magx)
                    : Quaternion.fromAccel(correctedAccelx, correctedAccely, correctedAccelz);
            }
            warnLogger('Filtro de Kalman y orientacion reiniciados por falta de datos validos');
        }

        lastPayloadTime = currentTime;

        const currentAltitude = Number.isFinite(altitudeState.relativeAltitude)
            ? altitudeState.relativeAltitude
            : (Number.isFinite(altitude) ? altitude : null);

        if (currentAltitude !== null) {
            if (peakAltitude === null || currentAltitude > peakAltitude) {
                peakAltitude = currentAltitude;
            }

            if (peakAltitude !== null && currentAltitude <= peakAltitude - 30) {
                setDecouplingStatus(true);
            }
        }

        const decouplingStatus = payloadSensors.decouplingStatus === true;
        const activeSourceChannel = payloadSensors.sourceChannel;

        const atotal = (Number.isFinite(correctedAccelx) && Number.isFinite(correctedAccely) && Number.isFinite(correctedAccelz))
            ? Math.sqrt(correctedAccelx * correctedAccelx + correctedAccely * correctedAccely + correctedAccelz * correctedAccelz)
            : undefined;

        const processedTelemetry = {
            observedAt: currentTime,
            speed,
            temperature,
            pressure,
            accelx: correctedAccelx,
            accely: correctedAccely,
            accelz: correctedAccelz,
            atotal,
            gyrox,
            gyroy,
            gyroz,
            magx,
            magy,
            magz,
            altitude,
            latitude,
            longitude,
            receiverLatitude,
            receiverLongitude,
            distanceToReceiver,
            velocity,
            velocityZ: altitudeState.velocityZ,
            relativeAltitude: altitudeState.relativeAltitude,
            decouplingStatus,
            sourceChannel: activeSourceChannel
        };

        debugLogger('MERGED_STATE', { ...payloadSensors });
        debugLogger('PROCESSED', processedTelemetry);
        return processedTelemetry;
    }

    function setReceiverLocation(coords = {}) {
        const { latitude, longitude } = coords;
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            payloadSensors.receiverLatitude = latitude;
            payloadSensors.receiverLongitude = longitude;
            return true;
        }

        return false;
    }

    function setDecouplingStatus(isActive) {
        const normalizedStatus = isActive === true;
        const previousStatus = payloadSensors.decouplingStatus === true;
        payloadSensors.decouplingStatus = normalizedStatus;
        return previousStatus !== normalizedStatus;
    }

    function getReceiverLocation() {
        const { receiverLatitude, receiverLongitude } = payloadSensors;
        if (!Number.isFinite(receiverLatitude) || !Number.isFinite(receiverLongitude)) {
            return null;
        }

        return {
            latitude: receiverLatitude,
            longitude: receiverLongitude
        };
    }

    function calibrateAccelerometer(accelx, accely, accelz) {
        const accelTotal = Math.sqrt(accelx * accelx + accely * accely + accelz * accelz);
        if (Math.abs(accelTotal - 1) < 0.2) {
            calibrationSamples.push({ x: accelx, y: accely, z: accelz });
        }

        const maxSamples = 100;
        if (calibrationSamples.length >= maxSamples) {
            accelBias.x = calibrationSamples.reduce((sum, sample) => sum + sample.x, 0) / calibrationSamples.length;
            accelBias.y = calibrationSamples.reduce((sum, sample) => sum + sample.y, 0) / calibrationSamples.length;
            accelBias.z = calibrationSamples.reduce((sum, sample) => sum + sample.z, 0) / calibrationSamples.length - 1;
            infoLogger('Acelerometro calibrado', { ...accelBias });
            calibrationSamples = [];
        }
    }

    function updateAltitudeState({
        altitude,
        correctedAccelx,
        correctedAccely,
        correctedAccelz,
        gyrox,
        gyroy,
        gyroz,
        magx,
        magy,
        magz,
        currentTime
    }) {
        const result = {
            relativeAltitude: undefined,
            velocityZ: undefined
        };

        const gravity = 9.81;
        if (!(Number.isFinite(altitude) && Number.isFinite(correctedAccelx) && Number.isFinite(correctedAccely) && Number.isFinite(correctedAccelz))) {
            return result;
        }

        if (!payloadKalman) {
            payloadKalman = new KalmanFilter();
            payloadOrientation = Number.isFinite(magx)
                ? Quaternion.fromAccelAndMag(correctedAccelx, correctedAccely, correctedAccelz, magx)
                : Quaternion.fromAccel(correctedAccelx, correctedAccely, correctedAccelz);
        }

        const deltaTime = lastPayloadTime ? Math.min((currentTime - lastPayloadTime) / 1000, 0.5) : 0.1;
        if (!(deltaTime > 0 && deltaTime <= 0.5)) {
            return result;
        }

        payloadOrientation = payloadOrientation.update(
            Number.isFinite(gyrox) ? gyrox : 0,
            Number.isFinite(gyroy) ? gyroy : 0,
            Number.isFinite(gyroz) ? gyroz : 0,
            deltaTime
        );

        if (Number.isFinite(magx)) {
            payloadOrientation = payloadOrientation.correctYaw(magx);
        }
        payloadOrientation = payloadOrientation.correctOrientation(correctedAccelx, correctedAccely, correctedAccelz, magy, magz);

        const accelVector = [correctedAccelx * gravity, correctedAccely * gravity, correctedAccelz * gravity];
        const rotatedAccel = payloadOrientation.rotateVector(accelVector);
        let accelZNet = rotatedAccel[2] - gravity;

        if (Math.abs(accelZNet) < 0.02) {
            accelZNet = 0;
        }

        payloadKalman.predict(accelZNet, deltaTime);
        if (altitude >= 0 && altitude <= 2000) {
            payloadKalman.update(altitude);
        }

        const state = payloadKalman.getState();
        result.relativeAltitude = state.relativeAltitude;
        result.velocityZ = state.velocityZ;

        const accelTotal = Math.sqrt(correctedAccelx * correctedAccelx + correctedAccely * correctedAccely + correctedAccelz * correctedAccelz);
        const gyroTotal = Math.sqrt((gyrox || 0) * (gyrox || 0) + (gyroy || 0) * (gyroy || 0) + (gyroz || 0) * (gyroz || 0));
        if (Math.abs(accelTotal - 1) < 0.15 && Math.abs(result.velocityZ) < 0.1 && Math.abs(altitude) < 10 && gyroTotal < 5) {
            result.relativeAltitude = 0;
            result.velocityZ = 0;
            payloadKalman.reset();
            payloadOrientation = Number.isFinite(magx)
                ? Quaternion.fromAccelAndMag(correctedAccelx, correctedAccely, correctedAccelz, magx)
                : Quaternion.fromAccel(correctedAccelx, correctedAccely, correctedAccelz);
        }

        lastPayloadUpdateTime = currentTime;
        return result;
    }

    return {
        getReceiverLocation,
        process,
        setDecouplingStatus,
        setReceiverLocation,
        getPayloadSensors: () => ({ ...payloadSensors })
    };
}

function sanitizeReceiverLocation(initialReceiverLocation = {}) {
    const receiverLatitude = initialReceiverLocation.receiverLatitude;
    const receiverLongitude = initialReceiverLocation.receiverLongitude;

    return Number.isFinite(receiverLatitude) && Number.isFinite(receiverLongitude)
        ? { receiverLatitude, receiverLongitude }
        : {};
}

function validateAcceleration(parsed) {
    const accelMax = 4;
    if (parsed.accelx === undefined && parsed.accely === undefined && parsed.accelz === undefined) {
        return { ok: true };
    }

    const ax = parsed.accelx;
    const ay = parsed.accely;
    const az = parsed.accelz;
    if (ax === undefined || ay === undefined || az === undefined) {
        return {
            ok: false,
            message: '⚠️ Se recibio aceleracion incompleta; se ignora la muestra',
            details: parsed
        };
    }

    if (Math.abs(ax) > accelMax || Math.abs(ay) > accelMax || Math.abs(az) > accelMax) {
        return {
            ok: false,
            message: `❌ Payload: Aceleracion fuera de rango: (${ax}, ${ay}, ${az})`
        };
    }

    return { ok: true };
}

module.exports = {
    createTelemetryProcessor
};
