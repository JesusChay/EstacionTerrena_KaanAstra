import { formatMetric, formatSourceChannel } from './formatters.js';

export function createStatusPresenter() {
  const fieldMap = {
    temperatureValue: (data) => formatMetric(data.temperature, 'degC'),
    pressureValue: (data) => formatMetric(data.pressure, 'hpa'),
    atotalValue: (data) => formatMetric(data.atotal, 'g'),
    relativeAltitudeValue: (data) => formatMetric(data.relativeAltitude, 'm'),
    altitudeValue: (data) => formatMetric(data.altitude, 'm'),
    infoAltitudeValue: (data) => formatMetric(data.altitude, 'm'),
    distanceValue: (data) => formatMetric(data.distanceToReceiver, 'm'),
    mapDistanceValue: (data) => formatMetric(data.distanceToReceiver, 'm'),
    windValue: (data) => formatMetric(data.speed, 'ms'),
    velocityValue: (data) => formatMetric(data.velocity, 'ms'),
    velocityZValue: (data) => formatMetric(data.velocityZ, 'ms'),
    latitudeValue: (data) => formatMetric(data.latitude, 'coord'),
    longitudeValue: (data) => formatMetric(data.longitude, 'coord'),
    receiverLatitudeValue: (data) => formatMetric(data.receiverLatitude, 'coord'),
    receiverLongitudeValue: (data) => formatMetric(data.receiverLongitude, 'coord'),
    sourceChannelValue: (data) => formatSourceChannel(data.sourceChannel),
    decouplingValue: (data) => data.decouplingStatus ? 'Activo' : 'Inactivo'
  };

  function renderTelemetry({ telemetry, sourceMode, stationStatus }) {
    if (!telemetry) return;

    Object.entries(fieldMap).forEach(([elementId, formatter]) => {
      const element = document.getElementById(elementId);
      if (element) {
        element.textContent = formatter(telemetry);
      }
    });

    document.getElementById('sampleTime').textContent = telemetry.time || '--:--:--';
    if (stationStatus) {
      setStationStatus(stationStatus.label, stationStatus.className);
    }
    setDataMode(sourceMode);
  }

  function setWorkerStatus(label, className) {
    const element = document.getElementById('workerStatus');
    element.textContent = label;
    element.className = `status-pill ${className}`;
  }

  function setStationStatus(label, className) {
    const element = document.getElementById('stationStatus');
    element.textContent = label;
    element.className = `status-pill ${className}`;
  }

  function setDataMode(value) {
    const element = document.getElementById('dataMode');
    if (element) {
      element.textContent = value;
    }
  }

  function updateSystemDateTime() {
    const element = document.getElementById('systemDateTime');
    if (!element) return;

    const now = new Date();
    element.textContent = now.toLocaleString('es-MX', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
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
