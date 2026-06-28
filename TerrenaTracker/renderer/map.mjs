import * as Leaflet from "leaflet";

const PAYLOAD_MARKER_URL = new URL("../assets/Marcador_Primaria.png", import.meta.url).href;
const RECEIVER_MARKER_URL = new URL("../assets/Marcador_Secundaria.png", import.meta.url).href;

let map = null;
let rocketMarker = null;
let groundMarker = null;
let trajectoryLine = null;
const trajectoryCoords = [];

export function initMap() {
  if (map) {
    invalidateMapSize();
    return;
  }

  map = Leaflet.map("map").setView([19.4326, -99.1332], 13);
  Leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>"
  }).addTo(map);

  trajectoryLine = Leaflet.polyline([], { color: "#ff4444", weight: 2, opacity: 0.7 }).addTo(map);
}

export function updateMap(data) {
  if (!map) initMap();

  const { rocket, ground, flight, signal, wind } = data;

  if (rocket && Number.isFinite(rocket.latitude) && Number.isFinite(rocket.longitude)) {
    const rLatLng = [rocket.latitude, rocket.longitude];

    if (rocketMarker) {
      rocketMarker.setLatLng(rLatLng);
    } else {
      rocketMarker = Leaflet.marker(rLatLng, {
        icon: Leaflet.icon({
          iconUrl: PAYLOAD_MARKER_URL,
          iconSize: [25, 41],
          iconAnchor: [12, 41]
        })
      }).addTo(map);
      rocketMarker.bindPopup("Cohete");
    }

    trajectoryCoords.push(rLatLng);
    if (trajectoryCoords.length > 200) trajectoryCoords.shift();
    trajectoryLine.setLatLngs(trajectoryCoords);

    setText("mapRocketCoords", rocket.latitude.toFixed(6) + ", " + rocket.longitude.toFixed(6));
    setText("mapRocketAlt", Number.isFinite(rocket.altitude) ? rocket.altitude.toFixed(1) + " m" : "--");

    map.setView(rLatLng, map.getZoom());
  }

  if (ground && Number.isFinite(ground.latitude) && Number.isFinite(ground.longitude)) {
    const gLatLng = [ground.latitude, ground.longitude];

    if (groundMarker) {
      groundMarker.setLatLng(gLatLng);
    } else {
      groundMarker = Leaflet.marker(gLatLng, {
        icon: Leaflet.icon({
          iconUrl: RECEIVER_MARKER_URL,
          iconSize: [25, 41],
          iconAnchor: [12, 41]
        })
      }).addTo(map);
      groundMarker.bindPopup("Estaci\u00f3n Terrena");
    }

    setText("mapGroundCoords", ground.latitude.toFixed(6) + ", " + ground.longitude.toFixed(6));
  }

  if (flight) {
    setText("mapFlightStatus", flight.status || "--");
    const alarmText = flight.alarm ? "ON" : "OFF";
    setText("mapAlarm", alarmText);
  }

  if (signal) {
    const rssi = Number.isFinite(signal.rssi) ? signal.rssi + " dBm" : "--";
    const snr = Number.isFinite(signal.snr) ? signal.snr + " dB" : "--";
    setText("mapSignal", "RSSI: " + rssi + " | SNR: " + snr);
  }

  if (wind && Number.isFinite(wind.velocity)) {
    setText("mapWind", wind.velocity.toFixed(1) + " m/s");
  }
}

export function invalidateMapSize() {
  if (map) setTimeout(() => map.invalidateSize(), 50);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
