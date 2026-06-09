const DEFAULT_PRESSURE_LEVELS_HPA = Object.freeze([1000, 975, 950, 925, 900, 850]);

function createOpenMeteoClient({
    apiBaseUrl = 'https://api.open-meteo.com/v1/forecast',
    fetchImpl,
    models,
    pressureLevelsHpa = DEFAULT_PRESSURE_LEVELS_HPA
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new TypeError('fetchImpl must be a function');
    }

    async function readWindProfile({ latitude, longitude, signal } = {}) {
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            throw new Error('OPEN_METEO_INVALID_COORDINATES');
        }

        const url = buildOpenMeteoUrl({
            apiBaseUrl,
            latitude,
            longitude,
            models,
            pressureLevelsHpa
        });
        const response = await fetchImpl(url, {
            headers: {
                Accept: 'application/json'
            },
            signal
        });

        if (!response.ok) {
            const reason = typeof response.text === 'function'
                ? await response.text()
                : `status ${response.status}`;
            throw new Error(`OPEN_METEO_HTTP_${response.status}: ${reason}`);
        }

        const payload = await response.json();
        const layers = mapWindLayers(payload, pressureLevelsHpa);
        if (layers.length === 0) {
            throw new Error('OPEN_METEO_EMPTY_PROFILE');
        }

        return {
            elevationMeters: Number.isFinite(payload.elevation) ? payload.elevation : null,
            fetchedAtUtc: new Date().toISOString(),
            generationTimeMs: Number.isFinite(payload.generationtime_ms) ? payload.generationtime_ms : null,
            latitude: Number.isFinite(payload.latitude) ? payload.latitude : latitude,
            layers,
            longitude: Number.isFinite(payload.longitude) ? payload.longitude : longitude,
            source: 'open-meteo'
        };
    }

    return {
        readWindProfile
    };
}

function buildOpenMeteoUrl({ apiBaseUrl, latitude, longitude, models, pressureLevelsHpa }) {
    const query = new URLSearchParams({
        forecast_hours: '1',
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        timezone: 'GMT',
        wind_speed_unit: 'ms'
    });

    if (typeof models === 'string' && models.trim()) {
        query.set('models', models.trim());
    }

    query.set('hourly', pressureLevelsHpa.flatMap((level) => [
        `wind_speed_${level}hPa`,
        `wind_direction_${level}hPa`,
        `geopotential_height_${level}hPa`
    ]).join(','));

    return `${apiBaseUrl}?${query.toString()}`;
}

function mapWindLayers(payload, pressureLevelsHpa) {
    const hourly = payload?.hourly;
    if (!hourly || typeof hourly !== 'object') {
        return [];
    }

    const groundElevationMeters = Number.isFinite(payload?.elevation) ? payload.elevation : 0;
    return pressureLevelsHpa
        .map((pressureLevelHpa) => mapWindLayer(hourly, pressureLevelHpa, groundElevationMeters))
        .filter(Boolean)
        .sort((left, right) => left.altitudeMeters - right.altitudeMeters);
}

function mapWindLayer(hourly, pressureLevelHpa, groundElevationMeters) {
    const speedMps = readFirstValue(hourly[`wind_speed_${pressureLevelHpa}hPa`]);
    const directionDeg = readFirstValue(hourly[`wind_direction_${pressureLevelHpa}hPa`]);
    const geopotentialHeightMeters = readFirstValue(hourly[`geopotential_height_${pressureLevelHpa}hPa`]);

    if (![speedMps, directionDeg, geopotentialHeightMeters].every(Number.isFinite)) {
        return null;
    }

    return {
        altitudeMeters: Math.max(0, geopotentialHeightMeters - groundElevationMeters),
        directionDeg,
        geopotentialHeightMeters,
        pressureLevelHpa,
        speedMps
    };
}

function readFirstValue(value) {
    if (Array.isArray(value) && value.length > 0 && Number.isFinite(value[0])) {
        return value[0];
    }

    return Number.isFinite(value) ? value : null;
}

module.exports = {
    DEFAULT_PRESSURE_LEVELS_HPA,
    createOpenMeteoClient
};
