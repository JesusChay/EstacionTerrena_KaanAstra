const { createTelemetrySampleDto } = require('@kaan-astra/telemetry-contracts');

function toTelemetrySampleDto(processedTelemetry, {
    locale = 'en-GB',
    timeZone = 'Europe/London'
} = {}) {
    if (!processedTelemetry) {
        return null;
    }

    const observedAt = processedTelemetry.observedAt instanceof Date
        ? processedTelemetry.observedAt
        : new Date(processedTelemetry.observedAt || Date.now());

    return createTelemetrySampleDto({
        time: observedAt.toLocaleTimeString(locale, { timeZone, hour12: false }) + '.' + String(observedAt.getMilliseconds()).padStart(3, '0'),
        speed: Number.isFinite(processedTelemetry.speed) ? (processedTelemetry.speed / 3.6).toFixed(2) : undefined,
        temperature: formatFinite(processedTelemetry.temperature, 2),
        pressure: formatFinite(processedTelemetry.pressure, 2),
        accelx: formatFinite(processedTelemetry.accelx, 2),
        accely: formatFinite(processedTelemetry.accely, 2),
        accelz: formatFinite(processedTelemetry.accelz, 2),
        atotal: formatFinite(processedTelemetry.atotal, 2),
        gyrox: formatFinite(processedTelemetry.gyrox, 2),
        gyroy: formatFinite(processedTelemetry.gyroy, 2),
        gyroz: formatFinite(processedTelemetry.gyroz, 2),
        gyroxRad: Number.isFinite(processedTelemetry.gyrox) ? (processedTelemetry.gyrox * 0.0174533).toFixed(4) : undefined,
        gyroyRad: Number.isFinite(processedTelemetry.gyroy) ? (processedTelemetry.gyroy * 0.0174533).toFixed(4) : undefined,
        gyrozRad: Number.isFinite(processedTelemetry.gyroz) ? (processedTelemetry.gyroz * 0.0174533).toFixed(4) : undefined,
        magx: formatFinite(processedTelemetry.magx, 2),
        magy: formatFinite(processedTelemetry.magy, 2),
        magz: formatFinite(processedTelemetry.magz, 2),
        altitude: formatFinite(processedTelemetry.altitude, 2),
        latitude: Number.isFinite(processedTelemetry.latitude) ? processedTelemetry.latitude.toFixed(6) : undefined,
        longitude: Number.isFinite(processedTelemetry.longitude) ? processedTelemetry.longitude.toFixed(6) : undefined,
        receiverLatitude: Number.isFinite(processedTelemetry.receiverLatitude) ? processedTelemetry.receiverLatitude.toFixed(6) : undefined,
        receiverLongitude: Number.isFinite(processedTelemetry.receiverLongitude) ? processedTelemetry.receiverLongitude.toFixed(6) : undefined,
        distanceToReceiver: formatFinite(processedTelemetry.distanceToReceiver, 2),
        velocity: formatFinite(processedTelemetry.velocity, 2),
        velocityZ: formatFinite(processedTelemetry.velocityZ, 2),
        relativeAltitude: formatFinite(processedTelemetry.relativeAltitude, 2),
        decouplingStatus: processedTelemetry.decouplingStatus === true,
        sourceChannel: processedTelemetry.sourceChannel
    });
}

function formatFinite(value, digits) {
    return Number.isFinite(value) ? value.toFixed(digits) : undefined;
}

module.exports = {
    toTelemetrySampleDto
};
