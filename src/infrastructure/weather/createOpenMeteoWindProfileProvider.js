const { calculateDistance } = require('../../domain/telemetry/telemetryMath');

function createOpenMeteoWindProfileProvider({
    client,
    coordinateChangeThresholdMeters = 750,
    fallbackProvider,
    infoLogger = () => {},
    now = () => new Date(),
    refreshIntervalMs = 15 * 60 * 1000,
    warnLogger = () => {}
} = {}) {
    if (!client || typeof client.readWindProfile !== 'function') {
        throw new TypeError('client.readWindProfile must be provided');
    }

    let cachedProfile = null;
    let inflightRefresh = null;
    let lastCoordinates = null;
    let lastRefreshAtMs = 0;

    function getProfile({ telemetry } = {}) {
        const resolvedCoordinates = resolveRequestCoordinates(telemetry);
        scheduleRefreshIfNeeded(resolvedCoordinates);

        if (cachedProfile) {
            return cachedProfile;
        }

        return readFallbackProfile(fallbackProvider, { telemetry });
    }

    async function refreshNow({ telemetry } = {}) {
        const resolvedCoordinates = resolveRequestCoordinates(telemetry);
        if (!resolvedCoordinates) {
            return cachedProfile || readFallbackProfile(fallbackProvider, { telemetry });
        }

        return refreshProfile(resolvedCoordinates, telemetry);
    }

    function getCachedProfile() {
        return cachedProfile;
    }

    function scheduleRefreshIfNeeded(resolvedCoordinates) {
        if (!resolvedCoordinates || inflightRefresh || !shouldRefresh(resolvedCoordinates)) {
            return;
        }

        void refreshProfile(resolvedCoordinates);
    }

    function shouldRefresh(resolvedCoordinates) {
        if (!cachedProfile) {
            return true;
        }

        const nowMs = now().getTime();
        if ((nowMs - lastRefreshAtMs) >= refreshIntervalMs) {
            return true;
        }

        if (!lastCoordinates) {
            return true;
        }

        const movedDistanceMeters = calculateDistance(
            lastCoordinates.latitude,
            lastCoordinates.longitude,
            resolvedCoordinates.latitude,
            resolvedCoordinates.longitude
        );

        return movedDistanceMeters >= coordinateChangeThresholdMeters;
    }

    async function refreshProfile(resolvedCoordinates, telemetry) {
        if (inflightRefresh) {
            return inflightRefresh;
        }

        inflightRefresh = client.readWindProfile(resolvedCoordinates)
            .then((profile) => {
                cachedProfile = {
                    ...profile,
                    source: 'open-meteo'
                };
                lastCoordinates = { ...resolvedCoordinates };
                lastRefreshAtMs = now().getTime();
                infoLogger(`Perfil de viento Open-Meteo actualizado para ${resolvedCoordinates.latitude.toFixed(4)}, ${resolvedCoordinates.longitude.toFixed(4)}`);
                return cachedProfile;
            })
            .catch((error) => {
                warnLogger(`No se pudo actualizar el perfil de viento de Open-Meteo: ${error.message}`);
                return cachedProfile || readFallbackProfile(fallbackProvider, { telemetry, source: 'static-fallback' });
            })
            .finally(() => {
                inflightRefresh = null;
            });

        return inflightRefresh;
    }

    return {
        getCachedProfile,
        getProfile,
        refreshNow
    };
}

function resolveRequestCoordinates(telemetry = {}) {
    if (hasUsableCoordinatePair(telemetry.latitude, telemetry.longitude)) {
        return {
            latitude: telemetry.latitude,
            longitude: telemetry.longitude
        };
    }

    if (hasUsableCoordinatePair(telemetry.receiverLatitude, telemetry.receiverLongitude)) {
        return {
            latitude: telemetry.receiverLatitude,
            longitude: telemetry.receiverLongitude
        };
    }

    return null;
}

function hasUsableCoordinatePair(latitude, longitude) {
    return Number.isFinite(latitude)
        && Number.isFinite(longitude)
        && !(latitude === 0 && longitude === 0);
}

function readFallbackProfile(fallbackProvider, { telemetry, source = 'static' } = {}) {
    const baseProfile = fallbackProvider?.getProfile
        ? fallbackProvider.getProfile({ telemetry })
        : { layers: [] };

    return {
        ...baseProfile,
        source
    };
}

module.exports = {
    createOpenMeteoWindProfileProvider
};
