import Chart from 'chart.js/auto';

let lastPayloadDataTime = null;
let lastDecouplingStatus = false;

function createLineChart(ctx, label, yAxisLabel, color) {
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label,
          data: [],
          borderColor: color,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 2,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'category',
          title: { display: true, text: 'Hora', font: { size: 12 } },
          ticks: { color: '#ffffff', font: { size: 10 } }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: yAxisLabel, font: { size: 12 } },
          ticks: { color: '#ffffff', font: { size: 10 } }
        }
      },
      plugins: {
        legend: { labels: { color: '#ffffff' } }
      },
      elements: {
        line: { tension: 0, spanGaps: true }
      }
    }
  });
}

function createAltitudeChart(ctx) {
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Altitud Alternativa',
          data: [],
          borderColor: '#4caf50',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 2,
          fill: false
        },
        {
          label: 'Altitud Absoluta',
          data: [],
          borderColor: '#2196f3',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 2,
          borderDash: [5, 5],
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'category',
          title: { display: true, text: 'Hora', font: { size: 12 } },
          ticks: { color: '#ffffff', font: { size: 10 } }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Altitud (m)', font: { size: 12 } },
          ticks: { color: '#ffffff', font: { size: 10 } }
        }
      },
      plugins: {
        legend: { labels: { color: '#ffffff' } }
      },
      elements: {
        line: { tension: 0, spanGaps: true }
      }
    }
  });
}

function createAccelChart(ctx) {
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Ax', data: [], borderColor: '#ff4444', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 2, fill: false },
        { label: 'Ay', data: [], borderColor: '#44ff44', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 2, fill: false },
        { label: 'Az', data: [], borderColor: '#4444ff', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 2, fill: false },
        { label: 'Atotal', data: [], borderColor: '#ffcc00', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 2, fill: false }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'category',
          title: { display: true, text: 'Hora', font: { size: 12 } },
          ticks: { color: '#ffffff', font: { size: 10 } }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'gravedad (g)', font: { size: 12 } },
          ticks: { color: '#ffffff', font: { size: 10 } }
        }
      },
      plugins: {
        legend: { labels: { color: '#ffffff' } }
      },
      elements: {
        line: { tension: 0, spanGaps: true }
      }
    }
  });
}

function pushChartPoint(chart, time, values) {
  if (!chart) return;
  if (chart.data.labels.length > 50) {
    chart.data.labels.splice(0, 1);
    chart.data.datasets.forEach((dataset) => dataset.data.splice(0, 1));
  }
  chart.data.labels.push(time);
  for (let index = 0; index < chart.data.datasets.length; index += 1) {
    chart.data.datasets[index].data.push(values[index] !== undefined ? values[index] : null);
  }
  chart.update();
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);

  globalThis.window.setTimeout(() => {
    notification.classList.add('show');
  }, 100);

  globalThis.window.setTimeout(() => {
    notification.classList.remove('show');
    globalThis.window.setTimeout(() => {
      notification.remove();
    }, 500);
  }, 3000);
}

function setReceiverLocationStatus(message, color = '#b9d7dc') {
  const statusElement = document.getElementById('receiverLocationStatus');
  statusElement.textContent = `Ubicacion de terrena: ${message}`;
  statusElement.style.color = color;
}

function setReceiverLocationMeta(message) {
  document.getElementById('receiverLocationMeta').textContent = message;
}

function setReceiverLocationActions({ showSettings = false, showRefresh = true } = {}) {
  document.getElementById('openLocationSettingsBtn').style.display = showSettings ? 'inline-block' : 'none';
  document.getElementById('refreshLocationBtn').style.display = showRefresh ? 'inline-block' : 'none';
}

function formatReceiverLocationMeta({ latitude, longitude, accuracy }) {
  const parts = [`Lat ${latitude.toFixed(6)}`, `Lon ${longitude.toFixed(6)}`];
  if (Number.isFinite(accuracy)) {
    parts.push(`+/- ${Math.round(accuracy)} m`);
  }
  return parts.join(' | ');
}

function applyReceiverLocationState(locationState = {}) {
  const { status, message, latitude, longitude, accuracy } = locationState;

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    setReceiverLocationMeta(formatReceiverLocationMeta({ latitude, longitude, accuracy }));
  } else {
    setReceiverLocationMeta(message || 'Sin coordenadas del receptor');
  }

  switch (status) {
    case 'active':
      setReceiverLocationStatus('activa', '#00ff88');
      setReceiverLocationActions({ showSettings: false, showRefresh: true });
      break;
    case 'low_accuracy':
      setReceiverLocationStatus(message || 'activa (precision baja)', '#ff9800');
      setReceiverLocationActions({ showSettings: false, showRefresh: true });
      break;
    case 'permission_denied':
      setReceiverLocationStatus(message || 'permiso denegado — activa Ubicacion en Configuracion de Windows', '#ff4d4f');
      setReceiverLocationActions({ showSettings: true, showRefresh: true });
      break;
    case 'unavailable':
      setReceiverLocationStatus(message || 'ubicacion no disponible — verifica WiFi o GPS', '#ff9800');
      setReceiverLocationActions({ showSettings: true, showRefresh: true });
      break;
    case 'unsupported':
      setReceiverLocationStatus(message || 'no soportada por el sistema', '#ff9800');
      setReceiverLocationActions({ showSettings: false, showRefresh: false });
      break;
    case 'error':
      setReceiverLocationStatus(message || 'error del proveedor de ubicacion del sistema', '#ff4d4f');
      setReceiverLocationActions({ showSettings: true, showRefresh: true });
      break;
    case 'searching':
    default:
      setReceiverLocationStatus('buscando...', '#4bc0c0');
      setReceiverLocationActions({ showSettings: false, showRefresh: true });
      break;
  }
}

const temperatureChart = createLineChart(
  document.getElementById('temperatureChart').getContext('2d'),
  'Temperatura',
  'Temperatura (degC)',
  '#ff9800'
);
const pressureChart = createLineChart(
  document.getElementById('pressureChart').getContext('2d'),
  'Presion',
  'Presion (hPa)',
  '#673ab7'
);
const altitudeChart = createAltitudeChart(
  document.getElementById('altitudeChart').getContext('2d')
);
const accelChart = createAccelChart(
  document.getElementById('accelChart').getContext('2d')
);
const windChart = createLineChart(
  document.getElementById('windChart').getContext('2d'),
  'Viento',
  'Viento (m/s)',
  '#00bcd4'
);
const velocityChart = createLineChart(
  document.getElementById('velocityChart').getContext('2d'),
  'Velocidad',
  'Velocidad (m/s)',
  '#ffeb3b'
);
const distanceChart = createLineChart(
  document.getElementById('distanceChart').getContext('2d'),
  'Distancia',
  'Distancia (m)',
  '#ff7043'
);

window.api.onPayloadData((data) => {
  lastPayloadDataTime = Date.now();
  const isDecouplingActive = data.decouplingStatus === true;

  pushChartPoint(temperatureChart, data.time, [data.temperature !== undefined ? Number.parseFloat(data.temperature) : null]);
  pushChartPoint(pressureChart, data.time, [data.pressure !== undefined ? Number.parseFloat(data.pressure) : null]);
  pushChartPoint(altitudeChart, data.time, [
    data.relativeAltitude !== undefined ? Number.parseFloat(data.relativeAltitude) : null,
    data.altitude !== undefined ? Number.parseFloat(data.altitude) : null
  ]);
  pushChartPoint(accelChart, data.time, [
    data.accelx !== undefined ? Number.parseFloat(data.accelx) : null,
    data.accely !== undefined ? Number.parseFloat(data.accely) : null,
    data.accelz !== undefined ? Number.parseFloat(data.accelz) : null,
    data.atotal !== undefined ? Number.parseFloat(data.atotal) : null
  ]);
  pushChartPoint(windChart, data.time, [data.speed !== undefined ? Number.parseFloat(data.speed) : null]);
  pushChartPoint(velocityChart, data.time, [data.velocity !== undefined ? Number.parseFloat(data.velocity) : null]);
  pushChartPoint(distanceChart, data.time, [data.distanceToReceiver !== undefined ? Number.parseFloat(data.distanceToReceiver) : null]);

  if (data.temperature !== undefined) document.getElementById('tempValue').textContent = `${data.temperature}degC`;
  if (data.pressure !== undefined) document.getElementById('pressureValue').textContent = `${data.pressure} hPa`;
  if (data.atotal !== undefined) document.getElementById('accelValue').textContent = `${data.atotal} g`;
  if (data.relativeAltitude !== undefined) document.getElementById('altitudeValue').textContent = `${data.relativeAltitude} m`;
  if (data.altitude !== undefined) document.getElementById('absoluteAltitudeValue').textContent = `${data.altitude} m`;
  if (data.speed !== undefined) document.getElementById('windValue').textContent = `${data.speed} m/s`;
  if (data.velocity !== undefined) document.getElementById('velocityValue').textContent = `${data.velocity} m/s`;
  if (data.distanceToReceiver !== undefined) document.getElementById('distanceValue').textContent = `${data.distanceToReceiver} m`;

  if (isDecouplingActive && !lastDecouplingStatus) {
    showNotification('Rele activado con exito');
  }

  lastDecouplingStatus = isDecouplingActive;
});

window.api.onError((message) => {
  showNotification(`Error: ${message}`);
});

window.api.onReportGenerated((data) => {
  showNotification(data.message);
});

window.api.onSimulationStatus((data) => {
  showNotification(data.message);
});

window.api.onReceiverLocation((location) => {
  applyReceiverLocationState(location);
});

function updateDriftCell(elementId, value) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = Number.isFinite(value) ? value.toFixed(3) : '--';
  }
}

function updateDriftDirCell(elementId, value) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = Number.isFinite(value) ? `${value.toFixed(1)}°` : '--';
  }
}

function formatWindSourceLabel(source) {
  if (source === 'open-meteo') return 'Open-Meteo';
  if (source === 'static-fallback') return 'Respaldo estatico';
  if (source === 'static') return 'Perfil estatico';
  return 'Sin perfil';
}

window.api.onLandingPrediction((prediction) => {
  updateDriftCell('hVelNorth', prediction?.horizontalVelocityVector?.northMps);
  updateDriftCell('hVelEast', prediction?.horizontalVelocityVector?.eastMps);
  updateDriftCell('hVelSpeed', prediction?.horizontalVelocityVector?.speedMps);
  updateDriftDirCell('hVelDir', prediction?.horizontalVelocityVector?.directionDeg);

  updateDriftCell('blendNorth', prediction?.blendedDriftVector?.northMps);
  updateDriftCell('blendEast', prediction?.blendedDriftVector?.eastMps);
  updateDriftCell('blendSpeed', prediction?.blendedDriftVector?.speedMps);
  updateDriftDirCell('blendDir', prediction?.blendedDriftVector?.directionDeg);

  updateDriftCell('windNorth', prediction?.windVector?.northMps);
  updateDriftCell('windEast', prediction?.windVector?.eastMps);
  updateDriftCell('windSpeed', prediction?.windVector?.speedMps);
  updateDriftDirCell('windDir', prediction?.windVector?.directionDeg);

  const windSourceEl = document.getElementById('driftWindSource');
  if (windSourceEl) {
    windSourceEl.textContent = formatWindSourceLabel(prediction?.windProfileSource);
  }
});

async function initializeDashboard() {
  applyReceiverLocationState({
    status: 'searching',
    message: 'buscando ubicacion del sistema...'
  });

  const select = document.getElementById('serialPortSelect');
  try {
    const ports = await window.api.listSerialPorts();
    ports.forEach((port) => {
      const option = document.createElement('option');
      option.value = port.path;
      option.text = `${port.path} (${port.manufacturer || 'Desconocido'})`;
      select.appendChild(option);
    });

    select.addEventListener('change', async (event) => {
      if (event.target.value) {
        const result = await window.api.setSerialPort(event.target.value);
        if (!result.success) {
          showNotification(`Error: ${result.message}`);
        }
      }
    });
  } catch (error) {
    showNotification(`Error al cargar los puertos seriales: ${error.message}`);
  }
}

document.getElementById('generateReportBtn').addEventListener('click', () => {
  window.api.generateReport();
});

document.getElementById('refreshLocationBtn').addEventListener('click', async () => {
  setReceiverLocationStatus('buscando...', '#4bc0c0');
  setReceiverLocationMeta('Solicitando nueva lectura del sistema...');
  await window.api.refreshReceiverLocation();
});

document.getElementById('openLocationSettingsBtn').addEventListener('click', async () => {
  const result = await window.api.openLocationSettings();
  if (!result?.success) {
    showNotification(result?.message || 'No se pudo abrir la configuracion de ubicacion');
  }
});

globalThis.window.setInterval(() => {
  const now = Date.now();
  const threshold = 5000;

  const status = document.getElementById('payloadStatus');
  if (lastPayloadDataTime && (now - lastPayloadDataTime) < threshold) {
    status.textContent = 'Recibiendo datos de carga';
    status.style.color = '#00ff00';
  } else {
    status.textContent = 'No se reciben datos de carga';
    status.style.color = '#ff0000';
  }
}, 1000);

initializeDashboard();
