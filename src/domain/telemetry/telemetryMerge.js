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

function isTelemetryValueUsable(key, value, sourceState = {}) {
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
        return isCoordinateValueUsable(key, value, sourceState);
    }

    return true;
}

function isCoordinateValueUsable(key, value, sourceState = {}) {
    if (value !== 0) {
        return true;
    }

    const counterpartKey = key === 'latitude'
        ? 'longitude'
        : key === 'longitude'
            ? 'latitude'
            : key === 'receiverLatitude'
                ? 'receiverLongitude'
                : 'receiverLatitude';
    const counterpartValue = sourceState[counterpartKey];

    return Number.isFinite(counterpartValue) && counterpartValue !== 0;
}

function shouldKeepRejectedTelemetryValue(key, value, sourceState = {}) {
    if (key === 'latitude' || key === 'longitude' || key === 'receiverLatitude' || key === 'receiverLongitude') {
        return isCoordinateValueUsable(key, value, sourceState);
    }

    return true;
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

        if (isTelemetryValueUsable(key, preferredValue, preferred)) {
            merged[key] = preferredValue;
        } else if (isTelemetryValueUsable(key, alternateValue, alternate)) {
            merged[key] = alternateValue;
        } else if (preferredValue !== undefined && shouldKeepRejectedTelemetryValue(key, preferredValue, preferred)) {
            merged[key] = preferredValue;
        } else if (alternateValue !== undefined && shouldKeepRejectedTelemetryValue(key, alternateValue, alternate)) {
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
