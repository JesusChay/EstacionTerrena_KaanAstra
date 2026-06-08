import 'leaflet/dist/leaflet.css';
import Leaflet from 'leaflet';

const PAYLOAD_MARKER_ICON_URL = new URL('../../assets/Marcador_Primaria.png', import.meta.url).href;

export function createMapPresenter({ containerElement }) {
  let map;
  let payloadMarker;
  let payloadPath;
  let payloadPathCoordinates = [];
  let firstValidPayloadCoord = false;
  let latestMapCoords = null;

  function initialize() {
    if (map || !containerElement) return;

    map = Leaflet.map(containerElement, { zoomControl: true }).setView([19.4326, -99.1332], 13);
    Leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    payloadPath = Leaflet.polyline([], {
      color: '#ff7b63',
      weight: 4,
      opacity: 0.9
    }).addTo(map);
  }

  function sync(samples) {
    if (!map || !payloadPath) return;

    payloadPathCoordinates = [];
    firstValidPayloadCoord = false;
    if (payloadMarker) {
      map.removeLayer(payloadMarker);
      payloadMarker = null;
    }

    samples.forEach(updateTelemetry);
    if (payloadPathCoordinates.length === 0) {
      payloadPath.setLatLngs([]);
    }
  }

  function updateTelemetry(data) {
    if (!map || !payloadPath || !data) return;

    const latitude = Number.parseFloat(data.latitude);
    const longitude = Number.parseFloat(data.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) {
      return;
    }

    const coords = [latitude, longitude];
    latestMapCoords = coords;

    const lastCoord = payloadPathCoordinates[payloadPathCoordinates.length - 1];
    if (!lastCoord || lastCoord[0] !== coords[0] || lastCoord[1] !== coords[1]) {
      payloadPathCoordinates.push(coords);
      payloadPath.setLatLngs(payloadPathCoordinates);
    }

    if (!payloadMarker) {
      payloadMarker = Leaflet.marker(coords, {
        icon: Leaflet.icon({
          iconUrl: PAYLOAD_MARKER_ICON_URL,
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

  function centerOnPayload() {
    if (map && latestMapCoords) {
      map.setView(latestMapCoords, 16);
    }
  }

  function invalidateSize() {
    if (map) {
      map.invalidateSize();
    }
  }

  function dispose() {
    if (map) {
      map.remove();
      map = null;
    }

    payloadMarker = null;
    payloadPath = null;
    payloadPathCoordinates = [];
    firstValidPayloadCoord = false;
    latestMapCoords = null;
  }

  return {
    dispose,
    initialize,
    sync,
    updateTelemetry,
    centerOnPayload,
    invalidateSize
  };
}
