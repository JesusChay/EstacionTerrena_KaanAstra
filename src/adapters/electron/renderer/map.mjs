import * as Leaflet from 'leaflet';
import { createLandingPredictionOverlay } from './landingPredictionOverlay.mjs';

const PAYLOAD_MARKER_ICON_URL = new URL('../../../../assets/Marcador_Primaria.png', import.meta.url).href;
const RECEIVER_MARKER_ICON_URL = new URL('../../../../assets/Marcador_Secundaria.png', import.meta.url).href;

let map = null;
let landingPredictionOverlay = null;
let payloadMarker = null;
let receiverMarker = null;
const payloadPath = Leaflet.polyline([], { color: 'red' });
const payloadPathCoordinates = [];
let firstValidPayloadCoord = false;

function initializeMap() {
  if (map) {
    return;
  }

  map = Leaflet.map('map').setView([19.4326, -99.1332], 13);
  Leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  payloadPath.addTo(map);
  landingPredictionOverlay = createLandingPredictionOverlay({ Leaflet, map });
  applyLandingPrediction(null);
}

function updateReceiverMarker(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) {
    return;
  }

  const receiverCoords = [latitude, longitude];
  if (receiverMarker) {
    receiverMarker.setLatLng(receiverCoords);
    return;
  }

  receiverMarker = Leaflet.marker(receiverCoords, {
    icon: Leaflet.icon({
      iconUrl: RECEIVER_MARKER_ICON_URL,
      iconSize: [25, 41],
      iconAnchor: [12, 41]
    })
  }).addTo(map);
  receiverMarker.bindPopup('Estacion Terrena');
}

function applyLandingPrediction(prediction) {
  if (!landingPredictionOverlay) {
    return;
  }

  const phase = typeof prediction?.phase === 'string' ? prediction.phase : 'waiting';
  const status = typeof prediction?.status === 'string' ? prediction.status : 'waiting';
  const confidence = typeof prediction?.confidence === 'string' ? prediction.confidence : 'low';
  const phaseBadge = document.getElementById('predictionPhaseBadge');

  phaseBadge.textContent = formatPhaseLabel(phase, status);
  phaseBadge.className = `prediction-phase-badge ${resolvePhaseClass(phase, status)}`;

  setText('predictionStatusValue', formatStatusLabel(status));
  setText('predictionEtaValue', formatEta(prediction?.etaSeconds));
  setText('predictionConfidenceValue', formatConfidenceLabel(confidence));
  setText('predictionRadiusValue', formatRadius(prediction?.uncertaintyRadiusMeters));
  setText('predictionLandingValue', formatLandingPoint(prediction?.predictedLanding));
  if (!prediction || status === 'waiting' || !prediction.predictedLanding || !Array.isArray(prediction.estimatedTrajectory) || prediction.estimatedTrajectory.length === 0) {
    landingPredictionOverlay.clear();
    return;
  }

  landingPredictionOverlay.render(prediction);
}

function setText(elementId, value) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = value;
  }
}

function formatPhaseLabel(phase, status) {
  if (status === 'landed') {
    return 'Aterrizado';
  }

  if (phase === 'predeploy') {
    return 'Sin desplegar';
  }

  if (phase === 'deployed') {
    return 'Desplegado';
  }

  return 'Esperando';
}

function resolvePhaseClass(phase, status) {
  if (status === 'landed') {
    return 'prediction-phase-landed';
  }

  if (phase === 'predeploy') {
    return 'prediction-phase-predeploy';
  }

  if (phase === 'deployed') {
    return 'prediction-phase-deployed';
  }

  return 'prediction-phase-waiting';
}

function formatStatusLabel(status) {
  if (status === 'tracking') {
    return 'Calculando';
  }

  if (status === 'landed') {
    return 'Aterrizado';
  }

  return 'Sin datos';
}

function formatEta(etaSeconds) {
  return Number.isFinite(etaSeconds) ? `${etaSeconds.toFixed(1)} s` : '--';
}

function formatConfidenceLabel(confidence) {
  if (confidence === 'high') {
    return 'Alta';
  }

  if (confidence === 'medium') {
    return 'Media';
  }

  return 'Baja';
}

function formatRadius(radiusMeters) {
  return Number.isFinite(radiusMeters) ? `${radiusMeters.toFixed(1)} m` : '--';
}

function formatLandingPoint(location) {
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    return 'Sin coordenadas';
  }

  return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
}

window.api.onPayloadData((data) => {
  const coords = [Number.parseFloat(data.latitude), Number.parseFloat(data.longitude)];
  if (!Number.isNaN(coords[0]) && !Number.isNaN(coords[1]) && coords[0] !== 0 && coords[1] !== 0) {
    payloadPathCoordinates.push(coords);
    payloadPath.setLatLngs(payloadPathCoordinates);
    if (payloadMarker) {
      payloadMarker.setLatLng(coords);
    } else {
      payloadMarker = Leaflet.marker(coords, {
        icon: Leaflet.icon({
          iconUrl: PAYLOAD_MARKER_ICON_URL,
          iconSize: [25, 41],
          iconAnchor: [12, 41]
        })
      }).addTo(map);
    }
    if (!firstValidPayloadCoord) {
      map.setView(coords, 13);
      firstValidPayloadCoord = true;
    }
  }

  const receiverLatitude = Number.parseFloat(data.receiverLatitude);
  const receiverLongitude = Number.parseFloat(data.receiverLongitude);
  updateReceiverMarker(receiverLatitude, receiverLongitude);
});

window.api.onReceiverLocation((location) => {
  updateReceiverMarker(location?.latitude, location?.longitude);
});

window.api.onLandingPrediction((prediction) => {
  applyLandingPrediction(prediction);
});

window.api.onError((message) => {
  globalThis.window.alert(message);
});

initializeMap();
