const API_BASE = window.APP_CONFIG?.apiBaseUrl || '/api';
const HISTORY_LIMIT = 30;
const REFRESH_INTERVAL_MS = 500;

const chartState = {
  labels: [],
  temperature: [],
  humidity: [],
  pressure: [],
  distanceToReceiver: [],
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

const charts = {
  temperature: buildChart('temperatureChart', [{ label: 'Temperatura', color: '#ff9f40', key: 'temperature' }]),
  humidity: buildChart('humidityChart', [{ label: 'Humedad', color: '#4bc0c0', key: 'humidity' }]),
  pressure: buildChart('pressureChart', [{ label: 'Presion', color: '#36a2eb', key: 'pressure' }]),
  distance: buildChart('distanceChart', [{ label: 'Distancia', color: '#ff7043', key: 'distanceToReceiver' }]),
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

let map;
let payloadMarker;
let payloadPath;
let payloadPathCoordinates = [];
let firstValidPayloadCoord = false;
let latestMapCoords = null;

let scene;
let camera;
let renderer;
let modelObject;
let fallbackModel;
let modelContainer;
let modelInitialized = false;

bootstrap();

async function bootstrap() {
  initializeTabs();
  initializeMap();
  initializeModel3D();
  animateModel();
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

  const centerMapButton = document.getElementById('centerMapBtn');
  if (centerMapButton) {
    centerMapButton.addEventListener('click', centerMapOnPayload);
  }
}

function initializeTabs() {
  const buttons = document.querySelectorAll('[data-tab]');
  const panels = document.querySelectorAll('[data-tab-panel]');

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.tab;

      buttons.forEach((entry) => {
        entry.classList.toggle('is-active', entry === button);
      });

      panels.forEach((panel) => {
        panel.classList.toggle('is-active', panel.dataset.tabPanel === target);
      });

      if (target === 'map' && map) {
        setTimeout(() => map.invalidateSize(), 50);
      }

      if (target === 'model') {
        handleModelResize();
      }
    });
  });
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
  updateMapTelemetry(data);
  updateModelTelemetry(data);
}

function syncCharts(samples) {
  resetChartState();
  samples.forEach(pushTelemetryPoint);
  syncMapPath(samples);
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

function initializeMap() {
  if (map || typeof L === 'undefined') return;

  map = L.map('mapView', { zoomControl: true }).setView([19.4326, -99.1332], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  payloadPath = L.polyline([], {
    color: '#ff7b63',
    weight: 4,
    opacity: 0.9
  }).addTo(map);
}

function syncMapPath(samples) {
  if (!map || !payloadPath) return;

  payloadPathCoordinates = [];
  firstValidPayloadCoord = false;
  if (payloadMarker) {
    map.removeLayer(payloadMarker);
    payloadMarker = null;
  }

  samples.forEach((sample) => updateMapTelemetry(sample));

  if (payloadPathCoordinates.length === 0) {
    payloadPath.setLatLngs([]);
  }
}

function updateMapTelemetry(data) {
  if (!map || !payloadPath || !data) return;

  const latitude = Number.parseFloat(data.latitude);
  const longitude = Number.parseFloat(data.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) {
    return;
  }

  const coords = [latitude, longitude];
  latestMapCoords = coords;
  document.getElementById('mapLatitudeValue').textContent = latitude.toFixed(6);
  document.getElementById('mapLongitudeValue').textContent = longitude.toFixed(6);
  if (data.distanceToReceiver !== undefined && data.distanceToReceiver !== null && data.distanceToReceiver !== '') {
    document.getElementById('mapDistanceValue').textContent = formatMetric(data.distanceToReceiver, 'm');
  }
  const lastCoord = payloadPathCoordinates[payloadPathCoordinates.length - 1];
  if (!lastCoord || lastCoord[0] !== coords[0] || lastCoord[1] !== coords[1]) {
    payloadPathCoordinates.push(coords);
    payloadPath.setLatLngs(payloadPathCoordinates);
  }

  if (!payloadMarker) {
    payloadMarker = L.marker(coords, {
      icon: L.icon({
        iconUrl: './assets/Marcador_Primaria.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41]
      })
    }).addTo(map);
  } else {
    payloadMarker.setLatLng(coords);
  }

  if (!firstValidPayloadCoord) {
    map.setView(coords, 15);
    firstValidPayloadCoord = true;
  }
}

function centerMapOnPayload() {
  if (map && latestMapCoords) {
    map.setView(latestMapCoords, 16);
  }
}

function initializeModel3D() {
  if (modelInitialized || typeof THREE === 'undefined') return;

  modelContainer = document.getElementById('model3dView');
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, modelContainer.clientWidth / modelContainer.clientHeight, 0.1, 1000);
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(modelContainer.clientWidth, modelContainer.clientHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  modelContainer.appendChild(renderer.domElement);

  fallbackModel = buildFallbackModel();
  scene.add(fallbackModel);

  loadRealModel();

  const ambient = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 1.2);
  directional.position.set(3, 3, 4);
  scene.add(directional);

  camera.position.set(0, 0.4, 5.5);
  camera.lookAt(0, 0, 0);

  window.addEventListener('resize', handleModelResize);
  modelInitialized = true;
}

function buildFallbackModel() {
  const group = new THREE.Group();

  const bodyGeometry = new THREE.CylinderGeometry(0.8, 0.8, 2.2, 32);
  const bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x6e7775, shininess: 60 });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  group.add(body);

  const capGeometry = new THREE.ConeGeometry(0.82, 0.55, 32);
  const capMaterial = new THREE.MeshPhongMaterial({ color: 0xd8b35e, shininess: 45 });
  const cap = new THREE.Mesh(capGeometry, capMaterial);
  cap.position.y = 1.35;
  group.add(cap);

  const baseRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.06, 16, 40),
    new THREE.MeshPhongMaterial({ color: 0x4bc0c0 })
  );
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = -1.1;
  group.add(baseRing);

  return group;
}

function loadRealModel() {
  if (typeof THREE.GLTFLoader === 'undefined') {
    return;
  }

  const loader = new THREE.GLTFLoader();
  loader.load(
    './assets/tacita.glb',
    (gltf) => {
      modelObject = gltf.scene;
      modelObject.scale.set(1.6, 1.6, 1.6);
      modelObject.position.set(0, -0.6, 0);
      scene.remove(fallbackModel);
      scene.add(modelObject);
    },
    undefined,
    () => {
      modelObject = fallbackModel;
    }
  );
}

function animateModel() {
  requestAnimationFrame(animateModel);
  if (modelInitialized && renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

function handleModelResize() {
  if (!modelInitialized || !modelContainer || !renderer || !camera) return;
  camera.aspect = modelContainer.clientWidth / modelContainer.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(modelContainer.clientWidth, modelContainer.clientHeight);
}

function updateModelTelemetry(data) {
  if (!modelInitialized || !data) return;

  const activeModel = modelObject || fallbackModel;
  if (!activeModel) return;

  const gx = data.gyroxRad !== undefined ? Number.parseFloat(data.gyroxRad) : (Number.parseFloat(data.gyrox) || 0) * 0.0174533;
  const gy = data.gyroyRad !== undefined ? Number.parseFloat(data.gyroyRad) : (Number.parseFloat(data.gyroy) || 0) * 0.0174533;
  const gz = data.gyrozRad !== undefined ? Number.parseFloat(data.gyrozRad) : (Number.parseFloat(data.gyroz) || 0) * 0.0174533;

  activeModel.rotation.x = Number.isFinite(gx) ? gx : 0;
  activeModel.rotation.y = Number.isFinite(gy) ? gy : 0;
  activeModel.rotation.z = Number.isFinite(gz) ? gz : 0;

  document.getElementById('gyroX').textContent = `X: ${Number.isFinite(gx) ? gx.toFixed(4) : '0.0000'} rad/s`;
  document.getElementById('gyroY').textContent = `Y: ${Number.isFinite(gy) ? gy.toFixed(4) : '0.0000'} rad/s`;
  document.getElementById('gyroZ').textContent = `Z: ${Number.isFinite(gz) ? gz.toFixed(4) : '0.0000'} rad/s`;
}

function pushTelemetryPoint(sample) {
  chartState.labels.push(sample.time || '--:--:--');
  chartState.temperature.push(asNumber(sample.temperature));
  chartState.humidity.push(asNumber(sample.humidity));
  chartState.pressure.push(asNumber(sample.pressure));
  chartState.distanceToReceiver.push(asNumber(sample.distanceToReceiver));
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

function formatSourceChannel(value) {
  if (!value) return '--';
  const normalized = String(value).toLowerCase();
  if (normalized === 'lora') return 'LoRa';
  if (normalized === 'xbee') return 'XBee';
  return value;
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
