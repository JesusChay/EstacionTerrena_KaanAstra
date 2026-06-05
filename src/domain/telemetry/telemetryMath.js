function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) {
        return 0;
    }

    const toRadians = (value) => value * Math.PI / 180;
    const earthRadiusMeters = 6371e3;
    const phi1 = toRadians(lat1);
    const phi2 = toRadians(lat2);
    const deltaPhi = toRadians(lat2 - lat1);
    const deltaLambda = toRadians(lon2 - lon1);

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2)
        + Math.cos(phi1) * Math.cos(phi2)
        * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusMeters * c;
}

function normalizeRawSensorUnits(parsed) {
    const normalized = { ...parsed };

    const accelKeys = ['accelx', 'accely', 'accelz'];
    const accelValues = accelKeys.map((key) => normalized[key]).filter(Number.isFinite);
    if (accelValues.length > 0 && accelValues.some((value) => Math.abs(value) > 4)) {
        accelKeys.forEach((key) => {
            if (Number.isFinite(normalized[key])) {
                normalized[key] = normalized[key] / 16384.0;
            }
        });
    }

    const gyroKeys = ['gyrox', 'gyroy', 'gyroz'];
    const gyroValues = gyroKeys.map((key) => normalized[key]).filter(Number.isFinite);
    if (gyroValues.length > 0 && gyroValues.some((value) => Math.abs(value) > 250)) {
        gyroKeys.forEach((key) => {
            if (Number.isFinite(normalized[key])) {
                normalized[key] = normalized[key] / 131.0;
            }
        });
    }

    return normalized;
}

module.exports = {
    calculateDistance,
    normalizeRawSensorUnits
};
