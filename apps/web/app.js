const API_BASE = window.APP_CONFIG?.apiBaseUrl || '/api';
const HISTORY_LIMIT = 30;
const REFRESH_INTERVAL_MS = 500;

const chartState = {
  labels: [],
  temperature: [],
  humidity: [],
  pressure: [],
  atotal: [],
  relativeAltitude: [],
  altitude: [],
  wind: [],
  velocity: [],
  velocityZ: []
};

const fieldMap = {
  temperatureValue: (data) => formatMetric(data.temperature, 'degC'),
  humidityValue: (data) => formatMetric(data.humidity, 'pct'),
  pressureValue: (data) => formatMetric(data.pressure, 'hpa'),
  atotalValue: (data) => formatMetric(data.atotal, 'g'),
  relativeAltitudeValue: (data) => formatMetric(data.relativeAltitude, 'm'),
  altitudeValue: (data) => formatMetric(data.altitude, 'm'),
  infoAltitudeValue: (data) => formatMetric(data.altitude, 'm'),
  windValue: (data) => formatMetric(data.speed, 'ms'),
  velocityValue: (data) => formatMetric(data.velocity, 'ms'),
  velocityZValue: (data) => formatMetric(data.velocityZ, 'ms'),
  latitudeValue: (data) => formatMetric(data.latitude, 'coord'),
  longitudeValue: (data) => formatMetric(data.longitude, 'coord'),
  decouplingValue: (data) => data.decouplingStatus ? 'Activo' : 'Inactivo'
};

const charts = {
  temperature: buildChart('temperatureChart', [{ label: 'Temperatura', color: '#ff9f40', key: 'temperature' }]),
  humidity: buildChart('humidityChart', [{ label: 'Humedad', color: '#4bc0c0', key: 'humidity' }]),
  pressure: buildChart('pressureChart', [{ label: 'Presion', color: '#36a2eb', key: 'pressure' }]),
  accel: buildChart('accelChart', [{ label: 'Aceleracion total', color: '#9966ff', key: 'atotal' }]),
  altitude: buildChart('altitudeChart', [
    { label: 'Altitud relativa', color: '#ffcd56', key: 'relativeAltitude' },
    { label: 'Altitud absoluta', color: '#ff6384', key: 'altitude' }
  ]),
  wind: buildChart('windChart', [{ label: 'Viento', color: '#4bc0c0', key: 'wind' }]),
  velocity: buildChart('velocityChart', [
    { label: 'Velocidad', color: '#36a2eb', key: 'velocity' },
    { label: 'Velocidad Z', color: '#ff6384', key: 'velocityZ' }
  ])
};

bootstrap();

async function bootstrap() {
  updateSystemDateTime();
  setInterval(updateSystemDateTime, 1000);

  const { samples, source } = await loadRecentTelemetry();
  syncCharts(samples);

  const latest = samples[samples.length - 1];
  if (latest && source === 'api') {
    renderTelemetry(latest, 'API');
    setWorkerStatus('Worker conectado', 'status-ok');
    setStationStatusByTelemetry(latest);
  } else {
    startDemoMode('API no disponible', samples);
  }

  setInterval(refreshLatestTelemetry, REFRESH_INTERVAL_MS);
  const downloadButton = document.getElementById('downloadReportBtn');
  if (downloadButton) {
    downloadButton.addEventListener('click', downloadReport);
  }
}

async function refreshLatestTelemetry() {
  try {
    const response = await fetch(`${API_BASE}/latest`, { cache: 'no-store' });
  if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!payload.telemetry) {
      throw new Error('Respuesta sin telemetria');
    }

    setWorkerStatus('Worker conectado', 'status-ok');
    renderTelemetry(payload.telemetry, 'API activa');
    appendTelemetryPoint(payload.telemetry);
  } catch (error) {
    setWorkerStatus('Worker sin enlace', 'status-error');
    setStationStatus('Sin datos de estacion', 'status-waiting');
  }
}

async function loadRecentTelemetry() {
  try {
    const response = await fetch(`${API_BASE}/recent?limit=${HISTORY_LIMIT}`, { cache: 'no-store' });
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
  setWorkerStatus(reason, 'status-waiting');
  setStationStatus('Modo demo local', 'status-waiting');
  setDataMode('Demo local');
  syncCharts(samples);
  renderTelemetry(samples[samples.length - 1], 'Demo local');
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
  setStationStatusByTelemetry(data);
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
  chartState.pressure.push(asNumber(sample.pressure));
  chartState.atotal.push(asNumber(sample.atotal));
  chartState.relativeAltitude.push(asNumber(sample.relativeAltitude));
  chartState.altitude.push(asNumber(sample.altitude));
  chartState.wind.push(asNumber(sample.speed));
  chartState.velocity.push(asNumber(sample.velocity));
  chartState.velocityZ.push(asNumber(sample.velocityZ));
}

function trimChartState() {
  while (chartState.labels.length > HISTORY_LIMIT) {
    Object.keys(chartState).forEach((key) => chartState[key].shift());
  }
}

function updateCharts() {
  Object.values(charts).forEach(({ chart, series }) => {
    chart.data.labels = [...chartState.labels];
    series.forEach((entry, index) => {
      chart.data.datasets[index].data = [...chartState[entry.key]];
    });
    chart.update();
  });
}

function resetChartState() {
  Object.keys(chartState).forEach((key) => {
    chartState[key] = [];
  });
}

function buildChart(elementId, series) {
  return {
    chart: new Chart(document.getElementById(elementId), {
      type: 'line',
      data: {
        labels: [],
        datasets: series.map((entry) => createDataset(entry.label, entry.color))
      },
      options: buildChartOptions()
    }),
    series
  };
}

function createDataset(label, color) {
  return {
    label,
    data: [],
    borderColor: color,
    backgroundColor: `${color}22`,
    tension: 0.3,
    borderWidth: 2,
    pointRadius: 1.5,
    pointHoverRadius: 3,
    fill: false
  };
}

function buildChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        labels: {
          color: '#f3fbff',
          boxWidth: 10,
          font: {
            family: 'Arial',
            size: 10
          }
        }
      }
    },
    scales: {
      x: {
        ticks: { color: '#c8d9dd', font: { size: 9 } },
        grid: { color: 'rgba(255,255,255,0.06)' }
      },
      y: {
        ticks: { color: '#c8d9dd', font: { size: 9 } },
        grid: { color: 'rgba(255,255,255,0.06)' }
      }
    }
  };
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

function setStationStatusByTelemetry(data) {
  const receivedAt = data?.receivedAtUtc ? Date.parse(data.receivedAtUtc) : Number.NaN;
  if (!Number.isFinite(receivedAt)) {
    setStationStatus('Datos de estacion recibidos', 'status-ok');
    return;
  }

  const ageMs = Date.now() - receivedAt;
  if (ageMs <= 5000) {
    setStationStatus('Recibiendo datos de estacion', 'status-ok');
    return;
  }

  if (ageMs <= 15000) {
    setStationStatus('Datos recientes de estacion', 'status-waiting');
    return;
  }

  setStationStatus('Sin datos recientes de estacion', 'status-error');
}

function setDataMode(value) {
  document.getElementById('dataMode').textContent = value;
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

async function downloadReport() {
  const button = document.getElementById('downloadReportBtn');
  if (button) {
    button.disabled = true;
    button.textContent = 'Generando...';
  }

  try {
    const response = await fetch(`${API_BASE}/report?limit=10000`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload.telemetry) ? payload.telemetry : [];
    if (rows.length === 0) {
      throw new Error('No hay datos disponibles para exportar.');
    }

    const csv = buildReportCsv(rows);
    const fileName = `kaan_astra_reporte_${buildTimestampTag(new Date())}.csv`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    window.alert(error.message || 'No se pudo generar el reporte.');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Descargar reporte';
    }
  }
}

function buildReportCsv(rows) {
  const columns = [
    ['Fecha de descarga', new Date().toLocaleString('es-MX', { hour12: false })],
    [],
    [
      'ID',
      'Hora',
      'Velocidad del viento (m/s)',
      'Temperatura (C)',
      'Humedad (%)',
      'Presion (hPa)',
      'Aceleracion X (g)',
      'Aceleracion Y (g)',
      'Aceleracion Z (g)',
      'Aceleracion Total (g)',
      'Giroscopio X (deg/s)',
      'Giroscopio Y (deg/s)',
      'Giroscopio Z (deg/s)',
      'Giroscopio X (rad/s)',
      'Giroscopio Y (rad/s)',
      'Giroscopio Z (rad/s)',
      'Magnetometro X',
      'Magnetometro Y',
      'Magnetometro Z',
      'Altitud absoluta (m)',
      'Altitud relativa (m)',
      'Latitud',
      'Longitud',
      'Velocidad horizontal (m/s)',
      'Velocidad vertical (m/s)',
      'Desacople',
      'Recibido UTC'
    ]
  ];

  rows.forEach((row) => {
    columns.push([
      row.id ?? '',
      row.time ?? '',
      row.speed ?? '',
      row.temperature ?? '',
      row.humidity ?? '',
      row.pressure ?? '',
      row.accelx ?? '',
      row.accely ?? '',
      row.accelz ?? '',
      row.atotal ?? '',
      row.gyrox ?? '',
      row.gyroy ?? '',
      row.gyroz ?? '',
      row.gyroxRad ?? '',
      row.gyroyRad ?? '',
      row.gyrozRad ?? '',
      row.magx ?? '',
      row.magy ?? '',
      row.magz ?? '',
      row.altitude ?? '',
      row.relativeAltitude ?? '',
      row.latitude ?? '',
      row.longitude ?? '',
      row.velocity ?? '',
      row.velocityZ ?? '',
      row.decouplingStatus ? 'Activo' : 'Inactivo',
      row.receivedAtUtc ?? ''
    ]);
  });

  return columns
    .map((row) => row.map(escapeCsvValue).join(','))
    .join('\n');
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? '');
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }
  return stringValue;
}

function buildTimestampTag(date) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ];

  return `${parts[0]}-${parts[1]}-${parts[2]}_${parts[3]}-${parts[4]}-${parts[5]}`;
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
  return [
    { time: '12:10:01', temperature: '24.10', humidity: '58.20', pressure: '1007.20', atotal: '1.02', relativeAltitude: '5.30', altitude: '128.60', speed: '4.20', velocity: '1.80', velocityZ: '0.65', latitude: '20.967370', longitude: '-89.623710', decouplingStatus: false },
    { time: '12:10:02', temperature: '24.13', humidity: '58.35', pressure: '1007.16', atotal: '1.03', relativeAltitude: '5.90', altitude: '129.05', speed: '4.28', velocity: '2.00', velocityZ: '0.72', latitude: '20.967372', longitude: '-89.623708', decouplingStatus: false },
    { time: '12:10:03', temperature: '24.15', humidity: '58.50', pressure: '1007.10', atotal: '1.04', relativeAltitude: '6.10', altitude: '129.10', speed: '4.35', velocity: '2.30', velocityZ: '0.82', latitude: '20.967372', longitude: '-89.623708', decouplingStatus: false },
    { time: '12:10:04', temperature: '24.16', humidity: '58.70', pressure: '1007.06', atotal: '1.03', relativeAltitude: '6.60', altitude: '129.55', speed: '4.46', velocity: '2.60', velocityZ: '0.89', latitude: '20.967374', longitude: '-89.623706', decouplingStatus: false },
    { time: '12:10:05', temperature: '24.18', humidity: '58.90', pressure: '1007.00', atotal: '1.03', relativeAltitude: '7.00', altitude: '130.00', speed: '4.55', velocity: '2.85', velocityZ: '0.91', latitude: '20.967375', longitude: '-89.623705', decouplingStatus: false },
    { time: '12:10:06', temperature: '24.20', humidity: '59.00', pressure: '1006.95', atotal: '1.02', relativeAltitude: '7.45', altitude: '130.35', speed: '4.66', velocity: '2.98', velocityZ: '0.84', latitude: '20.967376', longitude: '-89.623704', decouplingStatus: false },
    { time: '12:10:07', temperature: '24.22', humidity: '59.10', pressure: '1006.90', atotal: '1.01', relativeAltitude: '7.80', altitude: '130.80', speed: '4.70', velocity: '3.05', velocityZ: '0.76', latitude: '20.967377', longitude: '-89.623703', decouplingStatus: false },
    { time: '12:10:08', temperature: '24.24', humidity: '59.25', pressure: '1006.93', atotal: '1.00', relativeAltitude: '8.10', altitude: '130.95', speed: '4.32', velocity: '2.88', velocityZ: '0.18', latitude: '20.967379', longitude: '-89.623702', decouplingStatus: false },
    { time: '12:10:09', temperature: '24.28', humidity: '59.40', pressure: '1006.95', atotal: '0.99', relativeAltitude: '8.30', altitude: '131.00', speed: '4.10', velocity: '2.60', velocityZ: '-0.25', latitude: '20.967381', longitude: '-89.623701', decouplingStatus: false },
    { time: '12:10:10', temperature: '24.31', humidity: '59.50', pressure: '1007.00', atotal: '1.00', relativeAltitude: '8.20', altitude: '130.90', speed: '3.92', velocity: '2.35', velocityZ: '-0.45', latitude: '20.967383', longitude: '-89.623700', decouplingStatus: false },
    { time: '12:10:11', temperature: '24.35', humidity: '59.60', pressure: '1007.05', atotal: '1.00', relativeAltitude: '8.00', altitude: '130.75', speed: '3.80', velocity: '2.10', velocityZ: '-0.60', latitude: '20.967384', longitude: '-89.623699', decouplingStatus: true }
  ];
}
