const { calculateCoordinateDeltaMeters, hasValidCoordinate } = require('../../domain/landing-prediction/geoMath');
const { createCalmWindVector } = require('../../domain/landing-prediction/windProfileMath');
const { DEFAULT_PRE_DEPLOY_CONFIG, predictPreDeployTrajectory } = require('../../domain/landing-prediction/predictPreDeployTrajectory');
const { DEFAULT_POST_DEPLOY_CONFIG, predictPostDeployTrajectory } = require('../../domain/landing-prediction/predictPostDeployTrajectory');

const DEFAULT_LANDING_PREDICTION_CONFIG = Object.freeze({
    apogeeAltitudeMeters: 478,
    horizontalVelocityWindowMs: 10000,
    maxHistorySamples: 24,
    minHorizontalVelocityWindowMs: 1000,
    observedHorizontalWeight: 0.7,
    postDeployMassKg: 0.35,
    preDeployMassKg: 0.986,
    parachuteDiameterMeters: 0.58,
    parachuteAreaSquareMeters: Math.PI * Math.pow(0.58 / 2, 2),
    parachuteDragCoefficient: 1.75,
    parachuteNormalCoefficient: 0.15,
    tetherLengthMeters: 0.8,
    nominalDescentRateMps: 7,
    trajectoryPointCount: 8
});

function createLandingPredictionService({
    windProfileProvider,
    config = {}
} = {}) {
    const resolvedConfig = {
        ...DEFAULT_LANDING_PREDICTION_CONFIG,
        ...config
    };
    const sampleHistory = [];
    let latestPrediction = null;

    function update(processedTelemetry) {
        if (!processedTelemetry) {
            return latestPrediction;
        }

        rememberSample(sampleHistory, processedTelemetry, resolvedConfig);
        const phase = processedTelemetry.decouplingStatus === true ? 'deployed' : 'predeploy';
        const windProfile = windProfileProvider?.getProfile
            ? windProfileProvider.getProfile({ telemetry: processedTelemetry, config: resolvedConfig })
            : { source: 'none', layers: [] };
        const horizontalVelocityVector = estimateHorizontalVelocityVector(sampleHistory, resolvedConfig);
        const prediction = phase === 'deployed'
            ? predictPostDeployTrajectory({
                telemetry: processedTelemetry,
                horizontalVelocityVector,
                windProfile,
                config: buildPostDeployConfig(resolvedConfig)
            })
            : predictPreDeployTrajectory({
                telemetry: processedTelemetry,
                horizontalVelocityVector,
                windProfile,
                config: buildPreDeployConfig(resolvedConfig)
            });

        latestPrediction = prediction
            ? enrichPrediction({ prediction, processedTelemetry, resolvedConfig, horizontalVelocityVector })
            : createWaitingPrediction({ processedTelemetry, phase });

        return latestPrediction;
    }

    function getLatestPrediction() {
        return latestPrediction;
    }

    return {
        getLatestPrediction,
        update
    };
}

function enrichPrediction({ prediction, processedTelemetry, resolvedConfig, horizontalVelocityVector }) {
    return {
        ...prediction,
        observedAt: processedTelemetry.observedAt,
        modelVersion: 'landing-predictor-v1',
        currentLocation: hasValidCoordinate(processedTelemetry.latitude, processedTelemetry.longitude)
            ? {
                latitude: processedTelemetry.latitude,
                longitude: processedTelemetry.longitude
            }
            : null,
        horizontalVelocityVector: horizontalVelocityVector || createCalmWindVector(),
        inputs: {
            altitudeAglMeters: Number.isFinite(processedTelemetry.relativeAltitude)
                ? processedTelemetry.relativeAltitude
                : processedTelemetry.altitude,
            decouplingStatus: processedTelemetry.decouplingStatus === true,
            massKg: prediction.phase === 'deployed' ? resolvedConfig.postDeployMassKg : resolvedConfig.preDeployMassKg,
            parachuteAreaSquareMeters: resolvedConfig.parachuteAreaSquareMeters,
            verticalVelocityMps: processedTelemetry.velocityZ
        }
    };
}

function createWaitingPrediction({ processedTelemetry, phase }) {
    return {
        status: 'waiting',
        phase,
        observedAt: processedTelemetry?.observedAt,
        modelVersion: 'landing-predictor-v1',
        currentLocation: null,
        predictedLanding: null,
        estimatedTrajectory: [],
        etaSeconds: null,
        uncertaintyRadiusMeters: null,
        confidence: 'low'
    };
}

function rememberSample(sampleHistory, processedTelemetry, config) {
    sampleHistory.push({
        observedAt: processedTelemetry.observedAt,
        latitude: processedTelemetry.latitude,
        longitude: processedTelemetry.longitude,
        altitude: processedTelemetry.altitude,
        relativeAltitude: processedTelemetry.relativeAltitude,
        velocityZ: processedTelemetry.velocityZ,
        decouplingStatus: processedTelemetry.decouplingStatus === true
    });

    while (sampleHistory.length > config.maxHistorySamples) {
        sampleHistory.shift();
    }
}

function estimateHorizontalVelocityVector(sampleHistory, config) {
    const validSamples = sampleHistory.filter((sample) => hasValidCoordinate(sample.latitude, sample.longitude) && sample.observedAt instanceof Date);
    if (validSamples.length < 2) {
        return null;
    }

    const latestSample = validSamples[validSamples.length - 1];
    for (let index = validSamples.length - 2; index >= 0; index -= 1) {
        const candidateSample = validSamples[index];
        const deltaTimeMs = latestSample.observedAt - candidateSample.observedAt;
        if (!(deltaTimeMs >= config.minHorizontalVelocityWindowMs)) {
            continue;
        }

        if (deltaTimeMs > config.horizontalVelocityWindowMs) {
            break;
        }

        const deltaMeters = calculateCoordinateDeltaMeters(candidateSample, latestSample);
        if (!deltaMeters || deltaTimeMs <= 0) {
            continue;
        }

        const deltaTimeSeconds = deltaTimeMs / 1000;
        return {
            northMps: deltaMeters.northMeters / deltaTimeSeconds,
            eastMps: deltaMeters.eastMeters / deltaTimeSeconds,
            speedMps: deltaMeters.distanceMeters / deltaTimeSeconds
        };
    }

    return null;
}

function buildPreDeployConfig(config) {
    return {
        ...DEFAULT_PRE_DEPLOY_CONFIG,
        apogeeAltitudeMeters: config.apogeeAltitudeMeters,
        observedHorizontalWeight: config.observedHorizontalWeight,
        trajectoryPointCount: config.trajectoryPointCount,
        postDeploy: buildPostDeployConfig(config)
    };
}

function buildPostDeployConfig(config) {
    return {
        ...DEFAULT_POST_DEPLOY_CONFIG,
        nominalDescentRateMps: config.nominalDescentRateMps,
        observedHorizontalWeight: config.observedHorizontalWeight,
        trajectoryPointCount: config.trajectoryPointCount
    };
}

module.exports = {
    DEFAULT_LANDING_PREDICTION_CONFIG,
    createLandingPredictionService
};
