const API_BASE = window.APP_CONFIG?.apiBaseUrl || '/api';
const HISTORY_LIMIT = 24;

const chartState = {
  labels: [],
  temperature: [],
  humidity: [],
  relativeAltitude: [],
  velocity: [],
  velocityZ: []
};

const fieldMap = {
  temperatureValue: (data) => formatMetric(data.temperature, 'degC'),
  humidityValue: (data) => formatMetric(data.humidity, 'pct'),
  relativeAltitudeValue: (data) => formatMetric(data.relativeAltitude, 'm'),
  velocityZValue: (data) => formatMetric(data.velocityZ, 'ms'),
  pressureValue: (data) => formatMetric(data.pressure, 'hpa'),
  windValue: (data) => formatMetric(data.speed, 'ms'),
  velocityValue: (data) => formatMetric(data.velocity, 'ms'),
  altitudeValue: (data) => formatMetric(data.altitude, 'm'),
  latitudeValue: (data) => formatMetric(data.latitude, 'coord'),
  longitudeValue: (data) => formatMetric(data.longitude, 'coord'),
  atotalValue: (data) => formatMetric(data.atotal, 'g'),
  decouplingValue: (data) => data.decouplingStatus ? 'Activo' : 'Inactivo'
};

const environmentChart = new Chart(document.getElementById('environmentChart'), {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      createDataset('Temperatura', '#d4824f'),
      createDataset('Humedad', '#57b8b0'),
      createDataset('Altitud relativa', '#d4b06a')
    ]
  },
  options: buildChartOptions()
});

const motionChart = new Chart(document.getElementById('motionChart'), {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      createDataset('Velocidad', '#72a8db'),
      createDataset('Velocidad vertical', '#e66d63')
    ]
  },
  options: buildChartOptions()
});

bootstrap();

async function bootstrap() {
  const { samples, source } = await loadRecentTelemetry();
  syncCharts(samples);
  const latest = samples[samples.length - 1];
  if (latest && source === 'api') {
    renderTelemetry(latest, 'API');
    setApiStatus('Conectada', 'status-ok');
  } else {
    startDemoMode('API no disponible', samples);
  }

  setInterval(refreshLatestTelemetry, 4000);
}

async function refreshLatestTelemetry() {
  try {
    const response = await fetch(`${API_BASE}/latest`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!payload.telemetry) {
      throw new Error('Respuesta sin telemetria');
    }

    setApiStatus('Conectada', 'status-ok');
    setDataMode('API activa');
    appendTelemetryPoint(payload.telemetry);
    renderTelemetry(payload.telemetry, 'API');
  } catch (error) {
    setApiStatus('Modo demo', 'status-waiting');
    setDataMode('Demo local');
  }
}

async function loadRecentTelemetry() {
  try {
    const response = await fetch(`${API_BASE}/recent?limit=${HISTORY_LIMIT}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    return {
      samples: Array.isArray(payload.telemetry) ? payload.telemetry : [],
      source: 'api'
    };
  } catch (error) {
    return {
      samples: buildDemoTelemetry(),
      source: 'demo'
    };
  }
}

function startDemoMode(reason, samples = buildDemoTelemetry()) {
  setApiStatus(reason, 'status-waiting');
  setDataMode('Demo local');
  syncCharts(samples);
  renderTelemetry(samples[samples.length - 1], 'Demo');
}

function renderTelemetry(data, sourceMode) {
  if (!data) return;

  Object.entries(fieldMap).forEach(([elementId, formatter]) => {
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = formatter(data);
    }
  });

  document.getElementById('sampleTime').textContent = data.time || '--:--:--';
  setDataMode(sourceMode);
}

function syncCharts(samples) {
  resetChartState();
  samples.forEach(pushTelemetryPoint);
  updateCharts();
}

function appendTelemetryPoint(sample) {
  if (!sample) return;
  const time = sample.time || new Date().toLocaleTimeString('es-MX', { hour12: false });
  if (chartState.labels[chartState.labels.length - 1] === time) {
    return;
  }

  pushTelemetryPoint(sample);
  trimChartState();
  updateCharts();
}

function pushTelemetryPoint(sample) {
  chartState.labels.push(sample.time || '--:--:--');
  chartState.temperature.push(asNumber(sample.temperature));
  chartState.humidity.push(asNumber(sample.humidity));
  chartState.relativeAltitude.push(asNumber(sample.relativeAltitude));
  chartState.velocity.push(asNumber(sample.velocity));
  chartState.velocityZ.push(asNumber(sample.velocityZ));
}

function trimChartState() {
  while (chartState.labels.length > HISTORY_LIMIT) {
    Object.keys(chartState).forEach((key) => chartState[key].shift());
  }
}

function updateCharts() {
  environmentChart.data.labels = [...chartState.labels];
  environmentChart.data.datasets[0].data = [...chartState.temperature];
  environmentChart.data.datasets[1].data = [...chartState.humidity];
  environmentChart.data.datasets[2].data = [...chartState.relativeAltitude];
  environmentChart.update();

  motionChart.data.labels = [...chartState.labels];
  motionChart.data.datasets[0].data = [...chartState.velocity];
  motionChart.data.datasets[1].data = [...chartState.velocityZ];
  motionChart.update();
}

function resetChartState() {
  Object.keys(chartState).forEach((key) => {
    chartState[key] = [];
  });
}

function createDataset(label, color) {
  return {
    label,
    data: [],
    borderColor: color,
    backgroundColor: `${color}22`,
    tension: 0.3,
    borderWidth: 2,
    pointRadius: 2,
    pointHoverRadius: 4,
    fill: false
  };
}

function buildChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      intersect: false,
      mode: 'index'
    },
    plugins: {
      legend: {
        labels: {
          color: '#edf3ef',
          font: {
            family: 'IBM Plex Mono'
          }
        }
      }
    },
    scales: {
      x: {
        ticks: { color: '#9ab3ae' },
        grid: { color: 'rgba(255,255,255,0.06)' }
      },
      y: {
        ticks: { color: '#9ab3ae' },
        grid: { color: 'rgba(255,255,255,0.06)' }
      }
    }
  };
}

function setApiStatus(label, className) {
  const element = document.getElementById('apiStatus');
  element.textContent = label;
  element.className = `status-pill ${className}`;
}

function setDataMode(value) {
  document.getElementById('dataMode').textContent = value;
}

function formatMetric(value, type) {
  if (value === undefined || value === null || value === '') {
    return '--';
  }

  switch (type) {
    case 'degC':
      return `${value} C`;
    case 'pct':
      return `${value} %`;
    case 'm':
      return `${value} m`;
    case 'ms':
      return `${value} m/s`;
    case 'hpa':
      return `${value} hPa`;
    case 'coord':
      return `${value}`;
    case 'g':
      return `${value} g`;
    default:
      return `${value}`;
  }
}

function asNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildDemoTelemetry() {
  const base = [
    { time: '12:10:01', temperature: '24.10', humidity: '58.20', relativeAltitude: '5.30', velocity: '1.80', velocityZ: '0.65', pressure: '1007.20', speed: '4.20', altitude: '128.60', latitude: '20.967370', longitude: '-89.623710', atotal: '1.02', decouplingStatus: false },
    { time: '12:10:03', temperature: '24.15', humidity: '58.50', relativeAltitude: '6.10', velocity: '2.30', velocityZ: '0.82', pressure: '1007.10', speed: '4.35', altitude: '129.10', latitude: '20.967372', longitude: '-89.623708', atotal: '1.04', decouplingStatus: false },
    { time: '12:10:05', temperature: '24.18', humidity: '58.90', relativeAltitude: '7.00', velocity: '2.85', velocityZ: '0.91', pressure: '1007.00', speed: '4.55', altitude: '130.00', latitude: '20.967375', longitude: '-89.623705', atotal: '1.03', decouplingStatus: false },
    { time: '12:10:07', temperature: '24.22', humidity: '59.10', relativeAltitude: '7.80', velocity: '3.05', velocityZ: '0.76', pressure: '1006.90', speed: '4.70', altitude: '130.80', latitude: '20.967377', longitude: '-89.623703', atotal: '1.01', decouplingStatus: false },
    { time: '12:10:09', temperature: '24.28', humidity: '59.40', relativeAltitude: '8.30', velocity: '2.60', velocityZ: '-0.25', pressure: '1006.95', speed: '4.10', altitude: '131.00', latitude: '20.967381', longitude: '-89.623701', atotal: '0.99', decouplingStatus: false },
    { time: '12:10:11', temperature: '24.35', humidity: '59.60', relativeAltitude: '8.00', velocity: '2.10', velocityZ: '-0.60', pressure: '1007.05', speed: '3.80', altitude: '130.75', latitude: '20.967384', longitude: '-89.623699', atotal: '1.00', decouplingStatus: true }
  ];

  return base;
}
