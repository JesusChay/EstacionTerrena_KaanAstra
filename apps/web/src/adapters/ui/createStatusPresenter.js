import { createTelemetryViewState, formatSystemDateTime } from './telemetryViewState.js';

export function createStatusPresenter({ onViewStateChange = () => {} } = {}) {
  let currentStationStatus = {
    label: 'Sin datos de estacion',
    className: 'status-waiting'
  };

  function renderTelemetry({ telemetry, sourceMode, stationStatus }) {
    if (!telemetry) return;

    if (stationStatus) {
      currentStationStatus = { ...stationStatus };
    }

    onViewStateChange(createTelemetryViewState({
      telemetry,
      sourceMode,
      stationStatus: currentStationStatus
    }));
  }

  function setWorkerStatus(label, className) {
    onViewStateChange({
      workerStatus: {
        label,
        className
      }
    });
  }

  function setStationStatus(label, className) {
    currentStationStatus = { label, className };
    onViewStateChange({ stationStatus: { ...currentStationStatus } });
  }

  function setDataMode(value) {
    onViewStateChange({ sourceMode: value || '--' });
  }

  function updateSystemDateTime() {
    onViewStateChange({
      systemDateTime: formatSystemDateTime(new Date())
    });
  }

  function startClock() {
    updateSystemDateTime();
    return globalThis.window?.setInterval(updateSystemDateTime, 1000);
  }

  return {
    renderTelemetry,
    setWorkerStatus,
    setStationStatus,
    setDataMode,
    startClock
  };
}
