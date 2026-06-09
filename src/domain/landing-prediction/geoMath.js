const EARTH_RADIUS_METERS = 6371e3;

function hasValidCoordinate(latitude, longitude) {
    return Number.isFinite(latitude)
        && Number.isFinite(longitude)
        && !(latitude === 0 && longitude === 0);
}

function projectCoordinate({ latitude, longitude, northMeters = 0, eastMeters = 0 }) {
    if (!hasValidCoordinate(latitude, longitude)) {
        return null;
    }

    const latitudeRadians = toRadians(latitude);
    const deltaLatitude = (northMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
    const cosLatitude = Math.cos(latitudeRadians);
    const safeCosLatitude = Math.abs(cosLatitude) < 1e-6 ? 1e-6 : cosLatitude;
    const deltaLongitude = (eastMeters / (EARTH_RADIUS_METERS * safeCosLatitude)) * (180 / Math.PI);

    return {
        latitude: latitude + deltaLatitude,
        longitude: longitude + deltaLongitude
    };
}

function calculateCoordinateDeltaMeters(start, end) {
    if (!start || !end || !hasValidCoordinate(start.latitude, start.longitude) || !hasValidCoordinate(end.latitude, end.longitude)) {
        return null;
    }

    const meanLatitudeRadians = toRadians((start.latitude + end.latitude) / 2);
    const northMeters = toRadians(end.latitude - start.latitude) * EARTH_RADIUS_METERS;
    const eastMeters = toRadians(end.longitude - start.longitude) * EARTH_RADIUS_METERS * Math.cos(meanLatitudeRadians);

    return {
        northMeters,
        eastMeters,
        distanceMeters: Math.sqrt((northMeters * northMeters) + (eastMeters * eastMeters))
    };
}

function toRadians(value) {
    return value * Math.PI / 180;
}

module.exports = {
    calculateCoordinateDeltaMeters,
    hasValidCoordinate,
    projectCoordinate
};
