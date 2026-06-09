function createCalmWindVector() {
    return {
        northMps: 0,
        eastMps: 0,
        speedMps: 0,
        directionDeg: 0
    };
}

function toWindVector(layer = {}) {
    const speedMps = Number.isFinite(layer.speedMps) ? layer.speedMps : 0;
    const directionDeg = Number.isFinite(layer.directionDeg) ? layer.directionDeg : 0;
    if (speedMps === 0) {
        return createCalmWindVector();
    }

    const travelDirectionRadians = toRadians((directionDeg + 180) % 360);
    const northMps = Math.cos(travelDirectionRadians) * speedMps;
    const eastMps = Math.sin(travelDirectionRadians) * speedMps;

    return {
        northMps,
        eastMps,
        speedMps,
        directionDeg
    };
}

function interpolateWindVector(layers = [], altitudeMeters = 0) {
    const normalizedLayers = normalizeLayers(layers);
    if (normalizedLayers.length === 0) {
        return createCalmWindVector();
    }

    if (altitudeMeters <= normalizedLayers[0].altitudeMeters) {
        return toWindVector(normalizedLayers[0]);
    }

    const lastLayer = normalizedLayers[normalizedLayers.length - 1];
    if (altitudeMeters >= lastLayer.altitudeMeters) {
        return toWindVector(lastLayer);
    }

    for (let index = 1; index < normalizedLayers.length; index += 1) {
        const lower = normalizedLayers[index - 1];
        const upper = normalizedLayers[index];
        if (altitudeMeters > upper.altitudeMeters) {
            continue;
        }

        const weight = (altitudeMeters - lower.altitudeMeters) / (upper.altitudeMeters - lower.altitudeMeters);
        const lowerVector = toWindVector(lower);
        const upperVector = toWindVector(upper);
        return createVector({
            northMps: blendValue(lowerVector.northMps, upperVector.northMps, weight),
            eastMps: blendValue(lowerVector.eastMps, upperVector.eastMps, weight),
            directionDeg: blendDirection(lower.directionDeg, upper.directionDeg, weight)
        });
    }

    return createCalmWindVector();
}

function blendWindVectors({ observedVector, modeledVector, observedWeight = 0.7 } = {}) {
    const safeObservedWeight = clamp(observedWeight, 0, 1);
    const safeModeledWeight = 1 - safeObservedWeight;
    const observed = observedVector || createCalmWindVector();
    const modeled = modeledVector || createCalmWindVector();

    return createVector({
        northMps: (observed.northMps * safeObservedWeight) + (modeled.northMps * safeModeledWeight),
        eastMps: (observed.eastMps * safeObservedWeight) + (modeled.eastMps * safeModeledWeight)
    });
}

function createVector({ northMps = 0, eastMps = 0, directionDeg } = {}) {
    const speedMps = Math.sqrt((northMps * northMps) + (eastMps * eastMps));
    return {
        northMps,
        eastMps,
        speedMps,
        directionDeg: Number.isFinite(directionDeg) ? directionDeg : toMeteorologicalDirection(northMps, eastMps)
    };
}

function normalizeLayers(layers = []) {
    return layers
        .filter((layer) => layer && Number.isFinite(layer.altitudeMeters))
        .slice()
        .sort((left, right) => left.altitudeMeters - right.altitudeMeters);
}

function blendDirection(start, end, weight) {
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return 0;
    }

    let delta = ((end - start + 540) % 360) - 180;
    return (start + (delta * weight) + 360) % 360;
}

function toMeteorologicalDirection(northMps, eastMps) {
    if (northMps === 0 && eastMps === 0) {
        return 0;
    }

    const travelRadians = Math.atan2(eastMps, northMps);
    return ((travelRadians * 180 / Math.PI) - 180 + 360) % 360;
}

function blendValue(start, end, weight) {
    return start + ((end - start) * weight);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function toRadians(value) {
    return value * Math.PI / 180;
}

module.exports = {
    blendWindVectors,
    createCalmWindVector,
    createVector,
    interpolateWindVector,
    normalizeLayers,
    toWindVector
};
