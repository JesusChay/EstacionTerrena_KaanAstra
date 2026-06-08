import { formatMetric, formatSourceChannel } from './formatters.js';

const DEFAULT_WORKER_STATUS = Object.freeze({
  label: 'Worker sin enlace',
  className: 'status-waiting'
});

const DEFAULT_STATION_STATUS = Object.freeze({
  label: 'Sin datos de estacion',
  className: 'status-waiting'
});

export function createDefaultTelemetryViewState() {
  return {
    sampleTime: '--:--:--',
    sourceChannel: '--',
    sourceMode: '--',
    systemDateTime: formatSystemDateTime(new Date()),
    workerStatus: { ...DEFAULT_WORKER_STATUS },
    stationStatus: { ...DEFAULT_STATION_STATUS },
    metrics: {
      temperature: '--',
      pressure: '--',
      atotal: '--',
      relativeAltitude: '--',
      altitude: '--',
      wind: '--',
      velocity: '--',
      velocityZ: '--',
      distanceToReceiver: '--',
      latitude: '--',
      longitude: '--',
      receiverLatitude: '--',
      receiverLongitude: '--'
    },
    map: {
      latitude: '--',
      longitude: '--',
      distance: '--'
    },
    model: createModelViewState()
  };
}

export function createTelemetryViewState({ telemetry, sourceMode, stationStatus }) {
  return {
    sampleTime: telemetry?.time || '--:--:--',
    sourceChannel: formatSourceChannel(telemetry?.sourceChannel),
    sourceMode: sourceMode || '--',
    stationStatus: stationStatus ? { ...stationStatus } : { ...DEFAULT_STATION_STATUS },
    metrics: {
      temperature: formatMetric(telemetry?.temperature, 'degC'),
      pressure: formatMetric(telemetry?.pressure, 'hpa'),
      atotal: formatMetric(telemetry?.atotal, 'g'),
      relativeAltitude: formatMetric(telemetry?.relativeAltitude, 'm'),
      altitude: formatMetric(telemetry?.altitude, 'm'),
      wind: formatMetric(telemetry?.speed, 'ms'),
      velocity: formatMetric(telemetry?.velocity, 'ms'),
      velocityZ: formatMetric(telemetry?.velocityZ, 'ms'),
      distanceToReceiver: formatMetric(telemetry?.distanceToReceiver, 'm'),
      latitude: formatMetric(telemetry?.latitude, 'coord'),
      longitude: formatMetric(telemetry?.longitude, 'coord'),
      receiverLatitude: formatMetric(telemetry?.receiverLatitude, 'coord'),
      receiverLongitude: formatMetric(telemetry?.receiverLongitude, 'coord')
    },
    map: {
      latitude: formatMetric(telemetry?.latitude, 'coord'),
      longitude: formatMetric(telemetry?.longitude, 'coord'),
      distance: formatMetric(telemetry?.distanceToReceiver, 'm')
    }
  };
}

export function createModelViewState(modelState = {}) {
  return {
    gyroX: formatGyroAxis('X', modelState.gyroxRad),
    gyroY: formatGyroAxis('Y', modelState.gyroyRad),
    gyroZ: formatGyroAxis('Z', modelState.gyrozRad)
  };
}

export function mergeTelemetryViewState(currentState, patch) {
  return {
    ...currentState,
    ...patch,
    workerStatus: patch.workerStatus
      ? { ...currentState.workerStatus, ...patch.workerStatus }
      : currentState.workerStatus,
    stationStatus: patch.stationStatus
      ? { ...currentState.stationStatus, ...patch.stationStatus }
      : currentState.stationStatus,
    metrics: patch.metrics
      ? { ...currentState.metrics, ...patch.metrics }
      : currentState.metrics,
    map: patch.map
      ? { ...currentState.map, ...patch.map }
      : currentState.map,
    model: patch.model
      ? { ...currentState.model, ...patch.model }
      : currentState.model
  };
}

export function formatSystemDateTime(date = new Date()) {
  return date.toLocaleString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function formatGyroAxis(axis, value) {
  const formattedValue = Number.isFinite(value) ? value.toFixed(4) : '0.0000';
  return `${axis}: ${formattedValue} rad/s`;
}
