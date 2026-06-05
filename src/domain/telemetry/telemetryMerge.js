const MERGEABLE_TELEMETRY_FIELDS = [
    'speed', 'temperature', 'pressure',
    'accelx', 'accely', 'accelz', 'atotal',
    'gyrox', 'gyroy', 'gyroz', 'gyroxRad', 'gyroyRad', 'gyrozRad',
    'magx', 'magy', 'magz',
    'altitude', 'relativeAltitude',
    'latitude', 'longitude',
    'receiverLatitude', 'receiverLongitude',
    'distanceToReceiver', 'velocity', 'velocityZ',
    'decouplingStatus'
];

function isTelemetryValueUsable(key, value) {
    if (value === undefined || value === null) {
        return false;
    }

    if (typeof value === 'boolean') {
        return true;
    }

    if (!Number.isFinite(value)) {
        return false;
    }

    if (key === 'latitude' || key === 'longitude' || key === 'receiverLatitude' || key === 'receiverLongitude') {
        return value !== 0;
    }

    return value !== 0;
}

function getChannelState(payloadSources, sourceChannel) {
    if (sourceChannel === 'lora' || sourceChannel === 'xbee') {
        return payloadSources[sourceChannel];
    }

    return payloadSources.unknown;
}

function mergeTelemetrySources({ preferredSource, payloadSources, fallbackState = {} }) {
    const preferred = getChannelState(payloadSources, preferredSource);
    const alternate = preferredSource === 'lora'
        ? payloadSources.xbee
        : preferredSource === 'xbee'
            ? payloadSources.lora
            : {};
    const merged = {};

    for (const key of MERGEABLE_TELEMETRY_FIELDS) {
        const preferredValue = preferred[key];
        const alternateValue = alternate[key];

        if (isTelemetryValueUsable(key, preferredValue)) {
            merged[key] = preferredValue;
        } else if (isTelemetryValueUsable(key, alternateValue)) {
            merged[key] = alternateValue;
        } else if (preferredValue !== undefined) {
            merged[key] = preferredValue;
        } else if (alternateValue !== undefined) {
            merged[key] = alternateValue;
        }
    }

    merged.sourceChannel = preferredSource || preferred.sourceChannel || alternate.sourceChannel || fallbackState.sourceChannel;
    return merged;
}

module.exports = {
    MERGEABLE_TELEMETRY_FIELDS,
    getChannelState,
    mergeTelemetrySources
};
