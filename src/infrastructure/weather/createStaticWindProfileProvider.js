function createStaticWindProfileProvider({ layers } = {}) {
    const resolvedLayers = Array.isArray(layers) && layers.length > 0
        ? layers.map(normalizeLayer)
        : [
            normalizeLayer({ altitudeMeters: 0, speedMps: 0, directionDeg: 0 }),
            normalizeLayer({ altitudeMeters: 150, speedMps: 0, directionDeg: 0 }),
            normalizeLayer({ altitudeMeters: 300, speedMps: 0, directionDeg: 0 }),
            normalizeLayer({ altitudeMeters: 500, speedMps: 0, directionDeg: 0 })
        ];

    function getProfile() {
        return {
            source: 'static',
            layers: resolvedLayers.map((layer) => ({ ...layer }))
        };
    }

    return {
        getProfile
    };
}

function normalizeLayer(layer = {}) {
    return {
        altitudeMeters: Number.isFinite(layer.altitudeMeters) ? layer.altitudeMeters : 0,
        speedMps: Number.isFinite(layer.speedMps) ? layer.speedMps : 0,
        directionDeg: Number.isFinite(layer.directionDeg) ? layer.directionDeg : 0
    };
}

module.exports = {
    createStaticWindProfileProvider
};
