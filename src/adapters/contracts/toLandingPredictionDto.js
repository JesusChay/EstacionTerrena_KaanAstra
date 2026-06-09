const { createLandingPredictionSampleDto } = require('@kaan-astra/telemetry-contracts');

function toLandingPredictionDto(prediction) {
  if (!prediction || typeof prediction !== 'object') {
    return null;
  }

  return createLandingPredictionSampleDto({
    status: typeof prediction.status === 'string' ? prediction.status : 'waiting',
        phase: typeof prediction.phase === 'string' ? prediction.phase : 'unknown',
        confidence: typeof prediction.confidence === 'string' ? prediction.confidence : 'low',
        modelVersion: typeof prediction.modelVersion === 'string' ? prediction.modelVersion : 'landing-predictor-v1',
        windProfileSource: typeof prediction.windProfileSource === 'string' ? prediction.windProfileSource : 'unknown',
        observedAtUtc: toIsoString(prediction.observedAt),
        etaSeconds: roundFinite(prediction.etaSeconds, 1),
        uncertaintyRadiusMeters: roundFinite(prediction.uncertaintyRadiusMeters, 1),
        altitudeAglMeters: roundFinite(prediction.altitudeAglMeters, 2),
        currentDescentRateMps: roundFinite(prediction.currentDescentRateMps, 2),
        timeToDeploySeconds: roundFinite(prediction.timeToDeploySeconds, 1),
        deployAltitudeMeters: roundFinite(prediction.deployAltitudeMeters, 2),
        currentLocation: mapCoordinate(prediction.currentLocation),
        deployPoint: mapCoordinate(prediction.deployPoint),
        predictedLanding: mapCoordinate(prediction.predictedLanding),
        estimatedTrajectory: Array.isArray(prediction.estimatedTrajectory)
            ? prediction.estimatedTrajectory.map(mapTrajectoryPoint).filter(Boolean)
            : [],
        horizontalVelocityVector: mapVector(prediction.horizontalVelocityVector),
        blendedDriftVector: mapVector(prediction.blendedDriftVector),
        windVector: mapVector(prediction.windVector),
    inputs: mapInputs(prediction.inputs)
  });
}

function mapCoordinate(location) {
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
        return null;
    }

    return {
        latitude: roundFinite(location.latitude, 6),
        longitude: roundFinite(location.longitude, 6)
    };
}

function mapTrajectoryPoint(point) {
    const location = mapCoordinate(point);
    if (!location) {
        return null;
    }

    return {
        ...location,
        altitudeMeters: roundFinite(point.altitudeMeters, 2),
        etaSeconds: roundFinite(point.etaSeconds, 1)
    };
}

function mapVector(vector) {
    if (!vector || typeof vector !== 'object') {
        return null;
    }

    return {
        northMps: roundFinite(vector.northMps, 3),
        eastMps: roundFinite(vector.eastMps, 3),
        speedMps: roundFinite(vector.speedMps, 3),
        directionDeg: roundFinite(vector.directionDeg, 1)
    };
}

function mapInputs(inputs) {
    if (!inputs || typeof inputs !== 'object') {
        return null;
    }

    return {
        altitudeAglMeters: roundFinite(inputs.altitudeAglMeters, 2),
        decouplingStatus: inputs.decouplingStatus === true,
        massKg: roundFinite(inputs.massKg, 3),
        parachuteAreaSquareMeters: roundFinite(inputs.parachuteAreaSquareMeters, 4),
        verticalVelocityMps: roundFinite(inputs.verticalVelocityMps, 3)
    };
}

function roundFinite(value, digits) {
    return Number.isFinite(value)
        ? Number.parseFloat(value.toFixed(digits))
        : null;
}

function toIsoString(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        return null;
    }

    return value.toISOString();
}

module.exports = {
    toLandingPredictionDto
};
