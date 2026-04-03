let map = null;
let payloadMarker = null;
let payloadPath = L.polyline([], { color: 'red' });
let payloadPathCoordinates = [];
let firstValidPayloadCoord = false;

function initializeMap() {
  if (!map) {
    map = L.map('map').setView([19.4326, -99.1332], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    payloadPath.addTo(map);
  }
}

window.onload = () => {
  initializeMap();
};

window.api.onPayloadData((data) => {
  const coords = [parseFloat(data.latitude), parseFloat(data.longitude)];
  if (!isNaN(coords[0]) && !isNaN(coords[1]) && !(coords[0] === 0 && coords[1] === 0)) {
    payloadPathCoordinates.push(coords);
    payloadPath.setLatLngs(payloadPathCoordinates);
    if (payloadMarker) {
      payloadMarker.setLatLng(coords);
    } else {
      payloadMarker = L.marker(coords, {
        icon: L.icon({
          iconUrl: 'assets/Marcador_Primaria.png',
          iconSize: [25, 41],
          iconAnchor: [12, 41]
        })
      }).addTo(map);
    }
    if (!firstValidPayloadCoord) {
      map.setView(coords, 13);
      firstValidPayloadCoord = true;
    }
  } else {
    console.warn('Coordenadas invalidas para carga:', coords);
  }
});

window.api.onError((message) => {
  alert(message);
});
