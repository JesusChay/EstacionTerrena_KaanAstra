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

    if (isDecouplingActivatedLine(cleaned)) {
        logTelemetryDebug('EVENT', { event: 'decoupling-activated' });
        return { type: 'flight-event', event: 'decoupling-activated' };
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

function isDecouplingActivatedLine(line) {
    if (!line || typeof line !== 'string') {
        return false;
    }

    const normalized = line.trim().toLowerCase();
    return (/\brele(?:e|y)?\b/.test(normalized) && /\bactivad(?:o|a)?\b/.test(normalized))
        || (/\brelay\b/.test(normalized) && /\bactivat(?:ed|e)\b/.test(normalized));
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
    isDecouplingActivatedLine,
    resolveSerialTelemetryInput,
    stripEspLogPrefix
};
