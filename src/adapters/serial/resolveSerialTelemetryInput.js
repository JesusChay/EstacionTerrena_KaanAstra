const { parseTelemetryMessage, isTelemetryLine } = require('./telemetryParser');

function resolveSerialTelemetryInput(line, { logSerialDebug = () => {}, logTelemetryDebug = () => {} } = {}) {
    const trimmed = line.trim();
    if (!trimmed) {
        return { type: 'ignored' };
    }

    logSerialDebug('RX', trimmed);

    const cleaned = stripEspLogPrefix(trimmed);
    if (cleaned !== trimmed) {
        logSerialDebug('CLEAN', cleaned);
    }

    const parsed = parseTelemetryMessage(cleaned);
    if (parsed) {
        logTelemetryDebug('PARSED', parsed);
        return { type: 'telemetry', payload: parsed };
    }

    if (!isTelemetryLine(cleaned)) {
        logSerialDebug('IGNORED', cleaned);
        return { type: 'ignored' };
    }

    return {
        type: 'telemetry',
        payload: normalizeTelemetryEnvelope(cleaned)
    };
}

function stripEspLogPrefix(line) {
    return line
        .replace(/\x1b\[[0-9;]*m/gi, '')
        .replace(/\[[0-9;]+m/gi, '')
        .replace(/^[IWE]\s*\(\d+\)\s+[^:]+:\s*/, '')
        .trim();
}

function normalizeTelemetryEnvelope(line) {
    if (line.startsWith('[PAYLOAD]')) {
        return line.replace('[PAYLOAD]', '').trim();
    }
    if (line.startsWith('[PRIMARY]')) {
        return line.replace('[PRIMARY]', '').trim();
    }
    if (line.startsWith('[SECONDARY]')) {
        return line.replace('[SECONDARY]', '').trim();
    }

    return line;
}

module.exports = {
    resolveSerialTelemetryInput,
    stripEspLogPrefix
};
