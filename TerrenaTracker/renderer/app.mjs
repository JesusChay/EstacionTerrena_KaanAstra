import { initMap, updateMap, invalidateMapSize } from "./map.mjs";

initMap();

var serialSelect = document.getElementById("serialPortSelect");
if (serialSelect) {
  if (window.api && window.api.listSerialPorts) {
    window.api.listSerialPorts().then(function (ports) {
      for (var i = 0; i < ports.length; i++) {
        var opt = document.createElement("option");
        opt.value = ports[i].path;
        opt.textContent = ports[i].path + (ports[i].manufacturer ? " (" + ports[i].manufacturer + ")" : "");
        serialSelect.appendChild(opt);
      }
    }).catch(function () {});
  }

  serialSelect.addEventListener("change", function () {
    if (window.api && window.api.setSerialPort) {
      window.api.setSerialPort(this.value).catch(function () {});
    }
  });
}

if (window.api && window.api.onPayloadData) {
  window.api.onPayloadData(function (data) {
    updateMap(data);
  });
}

if (window.api && window.api.onError) {
  window.api.onError(function (msg) {
    console.error(msg);
  });
}
