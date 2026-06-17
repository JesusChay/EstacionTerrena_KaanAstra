import Chart from "chart.js/auto";
import { initModel3D } from "../src/adapters/ui/modelPresenter.js";
import { getSensorDisplayData } from "../src/application/sensorService.js";
import { formatField, formatHeading, formatWindDir } from "../src/adapters/ui/formatters.js";

const MAX_POINTS = 50;
let timeIndex = 0;

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
        label: label,
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

function createMultiChart(ctx, datasets) {
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: datasets.map(function(d) {
        return {
          label: d.label,
          data: [],
          borderColor: d.color,
          backgroundColor: "transparent",
          borderWidth: 2,
          pointRadius: 2,
          fill: false
        };
      })
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

function pushChartPoint(chart, values) {
  if (!chart) return;
  if (chart.data.labels.length > MAX_POINTS) {
    chart.data.labels.shift();
    chart.data.datasets.forEach(function(ds) { ds.data.shift(); });
  }
  chart.data.labels.push(formatTime(timeIndex));
  for (var i = 0; i < chart.data.datasets.length; i++) {
    chart.data.datasets[i].data.push(values[i] !== undefined ? values[i] : null);
  }
  chart.update("none");
}

var magChart = createMultiChart(
  document.getElementById("magChart").getContext("2d"),
  [
    { label: "X", color: "#ff4444" },
    { label: "Y", color: "#44ff44" },
    { label: "Z", color: "#4488ff" }
  ]
);

var windVelChart = createLineChart(
  document.getElementById("windChart").getContext("2d"),
  "Velocidad", "m/s", "#00bcd4"
);

function updateUI(data) {
  var m = data.mag;
  var w = data.wind;

  pushChartPoint(magChart, [m.x, m.y, m.z]);
  pushChartPoint(windVelChart, [w.speed]);

  document.getElementById("magValue").textContent =
    "X: " + formatField(m.x) + " Y: " + formatField(m.y) + " Z: " + formatField(m.z)
    + " \u00b5T | H: " + formatHeading(m.heading, m.headingCardinal)
    + " | T: " + formatField(m.total) + " \u00b5T";

  document.getElementById("windValue").textContent =
    "Vel: " + formatField(w.speed, 1) + " m/s | Dir: " + formatWindDir(w.direction, w.directionCardinal)
    + " | Raf: " + formatField(w.gust, 1) + " m/s | Temp: " + formatField(w.temperature, 1) + " \u00b0C";

  timeIndex++;
}

function demoLoop() {
  var data = getSensorDisplayData();
  updateUI(data);
}

initModel3D("model3d-container");
setInterval(demoLoop, 500);
demoLoop();