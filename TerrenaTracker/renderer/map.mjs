import * as Leaflet from "leaflet";

const PAYLOAD_MARKER_URL = new URL("../assets/Marcador_Primaria.png", import.meta.url).href;
const RECEIVER_MARKER_URL = new URL("../assets/Marcador_Secundaria.png", import.meta.url).href;

let map = null;
let rocketMarker = null;
let groundMarker = null;
let trajectoryLine = null;
const trajectoryCoords = [];
let lastValidRocketCoords = null;
let lastValidGroundCoords = null;

function isValidCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && (lat !== 0 || lon !== 0)
    && lat >= -90 && lat <= 90
    && lon >= -180 && lon <= 180;
}

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

  const { rocket, ground, flight } = data;

  if (rocket && isValidCoord(rocket.latitude, rocket.longitude)) {
    lastValidRocketCoords = [rocket.latitude, rocket.longitude];
    const rLatLng = lastValidRocketCoords;

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

  if (ground && isValidCoord(ground.latitude, ground.longitude)) {
    lastValidGroundCoords = [ground.latitude, ground.longitude];
    const gLatLng = lastValidGroundCoords;

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
}

export function invalidateMapSize() {
  if (map) setTimeout(() => map.invalidateSize(), 50);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
