function createLandingPredictionApiPublisher({
    enabled = true,
    fetchImpl = global.fetch,
    infoLogger = () => {},
    publishIntervalMs = 1000,
    url,
    warnLogger = () => {}
} = {}) {
    let publishFailures = 0;
    let lastPublishAt = 0;

    async function publish(prediction) {
        if (!enabled || !prediction || typeof fetchImpl !== 'function') {
            return;
        }

        const now = Date.now();
        if (Number.isFinite(publishIntervalMs) && publishIntervalMs > 0 && (now - lastPublishAt) < publishIntervalMs) {
            return;
        }

        lastPublishAt = now;

        try {
            const response = await fetchImpl(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ prediction })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            if (publishFailures > 0) {
                infoLogger('Conexion con la API de prediccion restablecida');
            }
            publishFailures = 0;
        } catch (error) {
            publishFailures += 1;
            if (publishFailures === 1 || publishFailures % 10 === 0) {
                warnLogger(`No se pudo publicar la prediccion en ${url}: ${error.message}`);
            }
        }
    }

    return {
        publish
    };
}

module.exports = {
    createLandingPredictionApiPublisher
};
