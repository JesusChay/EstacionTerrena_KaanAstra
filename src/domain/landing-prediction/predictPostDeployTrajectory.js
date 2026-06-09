const { hasValidCoordinate, projectCoordinate } = require('./geoMath');
const { blendWindVectors, createCalmWindVector, interpolateWindVector } = require('./windProfileMath');

const DEFAULT_POST_DEPLOY_CONFIG = Object.freeze({
    observedHorizontalWeight: 0.7,
    maxDescentRateMps: 15,
    minDescentRateMps: 3,
    nominalDescentRateMps: 7,
    trajectoryPointCount: 8
});

function predictPostDeployTrajectory({
    telemetry,
    horizontalVelocityVector,
    windProfile,
    config = {}
} = {}) {
    const resolvedConfig = {
        ...DEFAULT_POST_DEPLOY_CONFIG,
        ...config
    };
    const currentLocation = resolveCurrentLocation(telemetry);
    const altitudeAglMeters = resolveAltitudeAgl(telemetry);

    if (!currentLocation || !Number.isFinite(altitudeAglMeters)) {
        return null;
    }

    const currentDescentRateMps = resolveCurrentDescentRate(telemetry?.velocityZ, resolvedConfig);
    const etaSeconds = currentDescentRateMps > 0 ? altitudeAglMeters / currentDescentRateMps : 0;
    const windLayers = Array.isArray(windProfile?.layers) ? windProfile.layers : [];
    const currentModeledWind = interpolateWindVector(windLayers, altitudeAglMeters);
    const observedVector = horizontalVelocityVector || createCalmWindVector();
    const blendedDriftVector = blendWindVectors({
        observedVector,
        modeledVector: currentModeledWind,
        observedWeight: resolvedConfig.observedHorizontalWeight
    });
    const estimatedTrajectory = buildEstimatedTrajectory({
        altitudeAglMeters,
        currentLocation,
        etaSeconds,
        observedVector,
        resolvedConfig,
        windLayers
    });
    const predictedLanding = estimatedTrajectory[estimatedTrajectory.length - 1] || currentLocation;
    const modeledSpeedDifference = Math.abs((observedVector.speedMps || 0) - (currentModeledWind.speedMps || 0));
    const uncertaintyRadiusMeters = Math.max(20, (etaSeconds * 1.5) + (modeledSpeedDifference * Math.max(etaSeconds, 1)));
    const confidence = resolveConfidence({ etaSeconds, horizontalVelocityVector, windLayers });

    return {
        status: altitudeAglMeters <= 2 && currentDescentRateMps <= 1 ? 'landed' : 'tracking',
        phase: 'deployed',
        altitudeAglMeters,
        currentDescentRateMps,
        etaSeconds,
        predictedLanding,
        estimatedTrajectory,
        uncertaintyRadiusMeters,
        confidence,
        blendedDriftVector,
        windVector: currentModeledWind,
        windProfileSource: windProfile?.source || 'unknown'
    };
}

function buildEstimatedTrajectory({
    altitudeAglMeters,
    currentLocation,
    etaSeconds,
    observedVector,
    resolvedConfig,
    windLayers
}) {
    const pointCount = Math.max(2, resolvedConfig.trajectoryPointCount);
    const trajectory = [{
        ...currentLocation,
        altitudeMeters: altitudeAglMeters,
        etaSeconds
    }];

    let northMeters = 0;
    let eastMeters = 0;
    const dt = pointCount > 1 ? etaSeconds / (pointCount - 1) : 0;

    for (let index = 1; index < pointCount; index += 1) {
        const altitudeRatio = 1 - (index / (pointCount - 1));
        const sampleAltitudeMeters = Math.max(0, altitudeAglMeters * altitudeRatio);
        const modeledWind = interpolateWindVector(windLayers, sampleAltitudeMeters);
        const driftVector = blendWindVectors({
            observedVector,
            modeledVector: modeledWind,
            observedWeight: resolvedConfig.observedHorizontalWeight
        });
        northMeters += driftVector.northMps * dt;
        eastMeters += driftVector.eastMps * dt;

        const projectedCoordinate = projectCoordinate({
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
            northMeters,
            eastMeters
        }) || currentLocation;

        trajectory.push({
            ...projectedCoordinate,
            altitudeMeters: sampleAltitudeMeters,
            etaSeconds: Math.max(0, etaSeconds - (dt * index))
        });
    }

    return trajectory;
}

function resolveCurrentLocation(telemetry = {}) {
    if (!hasValidCoordinate(telemetry.latitude, telemetry.longitude)) {
        return null;
    }

    return {
        latitude: telemetry.latitude,
        longitude: telemetry.longitude
    };
}

function resolveAltitudeAgl(telemetry = {}) {
    if (Number.isFinite(telemetry.relativeAltitude)) {
        return Math.max(0, telemetry.relativeAltitude);
    }

    if (Number.isFinite(telemetry.altitude)) {
        return Math.max(0, telemetry.altitude);
    }

    return null;
}

function resolveCurrentDescentRate(verticalVelocityMps, config) {
    if (!Number.isFinite(verticalVelocityMps) || verticalVelocityMps >= 0) {
        return config.nominalDescentRateMps;
    }

    return clamp(Math.abs(verticalVelocityMps), config.minDescentRateMps, config.maxDescentRateMps);
}

function resolveConfidence({ etaSeconds, horizontalVelocityVector, windLayers }) {
    const hasObservedTrack = Number.isFinite(horizontalVelocityVector?.speedMps) && horizontalVelocityVector.speedMps > 0;
    if (!hasObservedTrack) {
        return 'low';
    }

    if (Array.isArray(windLayers) && windLayers.length >= 2 && etaSeconds <= 60) {
        return 'high';
    }

    return 'medium';
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

module.exports = {
    DEFAULT_POST_DEPLOY_CONFIG,
    predictPostDeployTrajectory
};
