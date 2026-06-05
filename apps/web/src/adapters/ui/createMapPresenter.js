import { formatMetric } from './formatters.js';

export function createMapPresenter() {
  const Leaflet = globalThis.window?.L;
  let map;
  let payloadMarker;
  let payloadPath;
  let payloadPathCoordinates = [];
  let firstValidPayloadCoord = false;
  let latestMapCoords = null;

  function initialize() {
    if (map || !Leaflet) return;

    map = Leaflet.map('mapView', { zoomControl: true }).setView([19.4326, -99.1332], 13);
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
      payloadMarker = Leaflet.marker(coords, {
        icon: Leaflet.icon({
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

  return {
    initialize,
    sync,
    updateTelemetry,
    centerOnPayload,
    invalidateSize
  };
}
