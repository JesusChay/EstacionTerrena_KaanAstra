import Chart from "chart.js/auto";
import { initModel3D, updateModelRotation } from "../src/adapters/ui/modelPresenter.js";
import { initMap, updateMap, invalidateMapSize } from "./map.mjs";

const MAX_POINTS = 50;
let timeIndex = 0;

const COMPASS_MAP = {
  "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5,
  "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5,
  "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5,
  "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5
};

function compassToDegrees(dir) {
  return COMPASS_MAP[dir] !== undefined ? COMPASS_MAP[dir] : null;
}

function formatTime(index) {
  const totalSec = Math.floor(index * 0.5);
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return m + ":" + s;
}

function createLineChart(ctx, label, yAxisLabel, color) {
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label,
        data: [],
        borderColor: color,
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 2,
        fill: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: "category",
          title: { display: true, text: "Hora", font: { size: 12 } },
          ticks: { color: "#ffffff", font: { size: 10 } }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: yAxisLabel, font: { size: 12 } },
          ticks: { color: "#ffffff", font: { size: 10 } }
        }
      },
      plugins: {
        legend: { labels: { color: "#ffffff" } }
      },
      elements: {
        line: { tension: 0, spanGaps: true }
      }
    }
  });
}

function pushChartPoint(chart, value, label) {
  if (!chart) return;
  if (chart.data.labels.length > MAX_POINTS) {
    chart.data.labels.shift();
    chart.data.datasets.forEach(ds => ds.data.shift());
  }
  chart.data.labels.push(label || formatTime(timeIndex));
  chart.data.datasets[0].data.push(value !== undefined && value !== null ? value : null);
  chart.update("none");
}

var headingChart = createLineChart(
  document.getElementById("magChart").getContext("2d"),
  "Heading", "\u00b0", "#ffcc44"
);

var windChart = createLineChart(
  document.getElementById("windChart").getContext("2d"),
    "Velocidad", "km/h", "#00bcd4"
);

function updateDashboardUI(data) {
  const { compass, wind, rocket, flight } = data;

  if (compass && compass.direction) {
    const deg = compassToDegrees(compass.direction);
    const label = compass.direction;
    pushChartPoint(headingChart, deg);
    document.getElementById("magValue").textContent =
      "Heading: " + (deg !== null ? deg.toFixed(1) + "\u00b0" : "--") + " (" + label + ") | Alt: "
      + (rocket && Number.isFinite(rocket.altitude) ? rocket.altitude.toFixed(1) + " m" : "--");
    updateModelRotation(label);
  }

  if (wind && Number.isFinite(wind.velocity)) {
    pushChartPoint(windChart, wind.velocity);
    document.getElementById("windValue").textContent =
      "Vel: " + wind.velocity.toFixed(1) + " m/s"
      + (compass && compass.direction ? " | Dir: " + compass.direction : "");
  }

  timeIndex++;
}

initModel3D("model3d-container");

var tabs = document.querySelectorAll(".tab-button");
var mapInitialized = false;
for (var i = 0; i < tabs.length; i++) {
  tabs[i].addEventListener("click", function () {
    var tabName = this.getAttribute("data-tab");
    for (var j = 0; j < tabs.length; j++) {
      tabs[j].classList.remove("is-active");
    }
    this.classList.add("is-active");
    var panels = document.querySelectorAll(".tab-panel");
    for (var j = 0; j < panels.length; j++) {
      panels[j].classList.remove("is-active");
    }
    var target = document.getElementById("panel-" + tabName);
    if (target) target.classList.add("is-active");
    if (tabName === "map") {
      if (!mapInitialized) {
        initMap();
        mapInitialized = true;
      } else {
        invalidateMapSize();
      }
    }
  });
}

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
    updateDashboardUI(data);
    updateMap(data);
  });
}

if (window.api && window.api.onError) {
  window.api.onError(function (msg) {
    console.error(msg);
  });
}
