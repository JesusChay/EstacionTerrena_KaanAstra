const IP_GEOLOCATION_TIMEOUT = 8000;
const IP_GEOLOCATION_URL = 'https://ip-api.com/json/';

async function getLocationByIP() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IP_GEOLOCATION_TIMEOUT);

    try {
        const response = await fetch(IP_GEOLOCATION_URL, {
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
            throw new Error(`IP geolocation HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.status !== 'success' || !Number.isFinite(data.lat) || !Number.isFinite(data.lon)) {
            throw new Error('IP geolocation invalid response');
        }

        return {
            latitude: data.lat,
            longitude: data.lon,
            accuracy: 5000
        };
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('IP_GEOLOCATION_TIMEOUT');
        }

        throw new Error('IP_GEOLOCATION_FAILED');
    } finally {
        clearTimeout(timeoutId);
    }
}

function createSystemReceiverLocationTracker({
    pollIntervalMs = 30000,
    locationReader = null,
    onLocation = () => {},
    onStatus = () => {},
    infoLogger = () => {},
    warnLogger = () => {}
} = {}) {
    let intervalId = null;
    let isPolling = false;
    let lastLocation = null;

    async function poll() {
        if (isPolling) {
            return;
        }

        isPolling = true;
        try {
            const location = await readCurrentSystemLocation();
            lastLocation = location;
            if (location.fromFallback) {
                infoLogger(`Ubicacion obtenida por IP (fallback): ${location.latitude}, ${location.longitude}`);
            } else {
                infoLogger(`Ubicacion del sistema actualizada: ${location.latitude}, ${location.longitude}`);
            }
            onLocation(location);
        } catch (error) {
            warnLogger(`No se pudo obtener la ubicacion del sistema: ${error.message}`);
            onStatus(mapTrackerErrorToState(error));
        } finally {
            isPolling = false;
        }
    }

    async function readCurrentSystemLocation() {
        if (locationReader) {
            try {
                const location = await locationReader();
                if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
                    throw new Error('LOCATION_INVALID_COORDINATES');
                }
                return location;
            } catch (error) {
                if (error.message === 'LOCATION_INVALID_COORDINATES') {
                    throw error;
                }
                warnLogger(`Location reader fallo, usando IP: ${error.message}`);
            }
        }

        try {
            const ipLocation = await getLocationByIP();
            return { ...ipLocation, fromFallback: true };
        } catch {
            throw locationReader
                ? new Error('LOCATION_UNAVAILABLE')
                : new Error('LOCATION_UNSUPPORTED_PLATFORM');
        }
    }

    return {
        async refresh() {
            onStatus({
                status: 'searching',
                message: 'buscando ubicacion del sistema...'
            });
            await poll();
        },
        start() {
            if (intervalId) {
                return;
            }

            onStatus({
                status: 'searching',
                message: 'buscando ubicacion del sistema...'
            });
            poll();
            intervalId = setInterval(poll, pollIntervalMs);
        },
        stop() {
            if (!intervalId) {
                return;
            }

            clearInterval(intervalId);
            intervalId = null;
        },
        getLastLocation() {
            return lastLocation ? { ...lastLocation } : null;
        }
    };
}

function mapTrackerErrorToState(error) {
    const code = error?.message;
    if (code === 'LOCATION_PERMISSION_DENIED') {
        return {
            status: 'permission_denied',
            message: 'permiso de ubicacion denegado — permite el acceso en la configuracion del sistema'
        };
    }

    if (code === 'LOCATION_UNAVAILABLE') {
        return {
            status: 'unavailable',
            message: 'no se pudo obtener la ubicacion — verifica tu conexion WiFi o GPS'
        };
    }

    if (code === 'LOCATION_UNSUPPORTED_PLATFORM') {
        return {
            status: 'unsupported',
            message: 'geolocalizacion no soportada en esta plataforma'
        };
    }

    return {
        status: 'error',
        message: 'error al obtener ubicacion del sistema'
    };
}

module.exports = {
    createSystemReceiverLocationTracker
};
