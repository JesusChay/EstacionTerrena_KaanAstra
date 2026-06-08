import * as Leaflet from 'leaflet';

const PAYLOAD_MARKER_ICON_URL = new URL('../../../../assets/Marcador_Primaria.png', import.meta.url).href;
const RECEIVER_MARKER_ICON_URL = new URL('../../../../assets/Marcador_Secundaria.png', import.meta.url).href;

let map = null;
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

window.api.onPayloadData((data) => {
  const coords = [Number.parseFloat(data.latitude), Number.parseFloat(data.longitude)];
  if (!Number.isNaN(coords[0]) && !Number.isNaN(coords[1]) && !(coords[0] === 0 && coords[1] === 0)) {
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

window.api.onError((message) => {
  globalThis.window.alert(message);
});

initializeMap();
