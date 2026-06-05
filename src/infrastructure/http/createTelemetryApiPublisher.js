function createTelemetryApiPublisher({
    url,
    enabled = true,
    publishIntervalMs = 1000,
    fetchImpl = global.fetch,
    infoLogger = () => {},
    warnLogger = () => {}
}) {
    let telemetryPublishFailures = 0;
    let lastTelemetryPublishAt = 0;

    async function publish(payloadData) {
        if (!enabled || !payloadData || typeof fetchImpl !== 'function') {
            return;
        }

        const now = Date.now();
        if (Number.isFinite(publishIntervalMs) && publishIntervalMs > 0 && now - lastTelemetryPublishAt < publishIntervalMs) {
            return;
        }

        lastTelemetryPublishAt = now;

        try {
            const response = await fetchImpl(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ telemetry: payloadData })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            if (telemetryPublishFailures > 0) {
                infoLogger('Conexion con la API de telemetria restablecida');
            }
            telemetryPublishFailures = 0;
        } catch (error) {
            telemetryPublishFailures += 1;
            if (telemetryPublishFailures === 1 || telemetryPublishFailures % 10 === 0) {
                warnLogger(`No se pudo publicar telemetria en ${url}: ${error.message}`);
            }
        }
    }

    return {
        publish
    };
}

module.exports = {
    createTelemetryApiPublisher
};
