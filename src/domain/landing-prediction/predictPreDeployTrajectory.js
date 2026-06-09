const { hasValidCoordinate, projectCoordinate } = require('./geoMath');
const { blendWindVectors, createCalmWindVector, interpolateWindVector } = require('./windProfileMath');
const { DEFAULT_POST_DEPLOY_CONFIG, predictPostDeployTrajectory } = require('./predictPostDeployTrajectory');

const DEFAULT_PRE_DEPLOY_CONFIG = Object.freeze({
    apogeeAltitudeMeters: 478,
    observedHorizontalWeight: 0.8,
    maxCoastSeconds: 25,
    gravityMps2: 9.81,
    postDeploy: DEFAULT_POST_DEPLOY_CONFIG,
    trajectoryPointCount: 8
});

function predictPreDeployTrajectory({
    telemetry,
    horizontalVelocityVector,
    windProfile,
    config = {}
} = {}) {
    const resolvedConfig = {
        ...DEFAULT_PRE_DEPLOY_CONFIG,
        ...config,
        postDeploy: {
            ...DEFAULT_POST_DEPLOY_CONFIG,
            ...(DEFAULT_PRE_DEPLOY_CONFIG.postDeploy || {}),
            ...(config.postDeploy || {})
        }
    };
    const currentLocation = resolveCurrentLocation(telemetry);
    const altitudeAglMeters = resolveAltitudeAgl(telemetry);

    if (!currentLocation || !Number.isFinite(altitudeAglMeters)) {
        return null;
    }

    const observedVector = horizontalVelocityVector || createCalmWindVector();
    const currentModeledWind = interpolateWindVector(windProfile?.layers || [], altitudeAglMeters);
    const ascentDriftVector = blendWindVectors({
        observedVector,
        modeledVector: currentModeledWind,
        observedWeight: resolvedConfig.observedHorizontalWeight
    });
    const deployAltitudeMeters = Math.max(altitudeAglMeters, resolvedConfig.apogeeAltitudeMeters);
    const timeToDeploySeconds = resolveTimeToDeploy({
        altitudeAglMeters,
        verticalVelocityMps: telemetry?.velocityZ,
        config: resolvedConfig
    });
    const deployPoint = projectCoordinate({
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        northMeters: ascentDriftVector.northMps * timeToDeploySeconds,
        eastMeters: ascentDriftVector.eastMps * timeToDeploySeconds
    }) || currentLocation;
    const postDeployPrediction = predictPostDeployTrajectory({
        telemetry: {
            ...telemetry,
            latitude: deployPoint.latitude,
            longitude: deployPoint.longitude,
            relativeAltitude: deployAltitudeMeters,
            velocityZ: -resolvedConfig.postDeploy.nominalDescentRateMps
        },
        horizontalVelocityVector: observedVector,
        windProfile,
        config: resolvedConfig.postDeploy
    });

    if (!postDeployPrediction) {
        return null;
    }

    const estimatedTrajectory = buildEstimatedTrajectory({
        altitudeAglMeters,
        currentLocation,
        deployAltitudeMeters,
        deployPoint,
        postDeployPrediction,
        timeToDeploySeconds
    });

    return {
        status: 'tracking',
        phase: 'predeploy',
        altitudeAglMeters,
        timeToDeploySeconds,
        deployAltitudeMeters,
        deployPoint,
        etaSeconds: timeToDeploySeconds + postDeployPrediction.etaSeconds,
        predictedLanding: postDeployPrediction.predictedLanding,
        estimatedTrajectory,
        uncertaintyRadiusMeters: postDeployPrediction.uncertaintyRadiusMeters + (timeToDeploySeconds * Math.max(observedVector.speedMps, 1)),
        confidence: postDeployPrediction.confidence === 'high' ? 'medium' : 'low',
        blendedDriftVector: ascentDriftVector,
        windVector: currentModeledWind,
        windProfileSource: windProfile?.source || 'unknown'
    };
}

function buildEstimatedTrajectory({
    altitudeAglMeters,
    currentLocation,
    deployAltitudeMeters,
    deployPoint,
    postDeployPrediction,
    timeToDeploySeconds
}) {
    const preDeployPoint = {
        ...deployPoint,
        altitudeMeters: deployAltitudeMeters,
        etaSeconds: postDeployPrediction.etaSeconds
    };

    return [
        {
            ...currentLocation,
            altitudeMeters: altitudeAglMeters,
            etaSeconds: timeToDeploySeconds + postDeployPrediction.etaSeconds
        },
        preDeployPoint,
        ...postDeployPrediction.estimatedTrajectory.slice(1)
    ];
}

function resolveTimeToDeploy({ altitudeAglMeters, verticalVelocityMps, config }) {
    const remainingAltitudeMeters = Math.max(0, config.apogeeAltitudeMeters - altitudeAglMeters);
    if (remainingAltitudeMeters === 0) {
        return 0;
    }

    if (!Number.isFinite(verticalVelocityMps) || verticalVelocityMps <= 0) {
        return 0;
    }

    const discriminant = (verticalVelocityMps * verticalVelocityMps) - (2 * config.gravityMps2 * remainingAltitudeMeters);
    if (discriminant >= 0) {
        const timeToDeploySeconds = (verticalVelocityMps - Math.sqrt(discriminant)) / config.gravityMps2;
        if (Number.isFinite(timeToDeploySeconds) && timeToDeploySeconds >= 0) {
            return Math.min(config.maxCoastSeconds, timeToDeploySeconds);
        }
    }

    return Math.min(config.maxCoastSeconds, remainingAltitudeMeters / Math.max(verticalVelocityMps, 1));
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

module.exports = {
    DEFAULT_PRE_DEPLOY_CONFIG,
    predictPreDeployTrajectory
};
