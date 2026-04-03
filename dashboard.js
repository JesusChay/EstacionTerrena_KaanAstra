let lastPayloadDataTime = null;

function createLineChart(ctx, label, yAxisLabel, color) {
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label,
          data: [],
          borderColor: color,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 2,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'category',
          title: { display: true, text: 'Hora', font: { size: 12 } },
          ticks: { color: '#ffffff', font: { size: 10 } }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: yAxisLabel, font: { size: 12 } },
          ticks: { color: '#ffffff', font: { size: 10 } }
        }
      },
      plugins: {
        legend: { labels: { color: '#ffffff' } }
      },
      elements: {
        line: { tension: 0, spanGaps: true }
      }
    }
  });
}

function createAltitudeChart(ctx) {
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Altitud Alternativa',
          data: [],
          borderColor: '#4caf50',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 2,
          fill: false
        },
        {
          label: 'Altitud Absoluta',
          data: [],
          borderColor: '#2196f3',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 2,
          borderDash: [5, 5],
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'category',
          title: { display: true, text: 'Hora', font: { size: 12 } },
          ticks: { color: '#ffffff', font: { size: 10 } }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Altitud (m)', font: { size: 12 } },
          ticks: { color: '#ffffff', font: { size: 10 } }
        }
      },
      plugins: {
        legend: { labels: { color: '#ffffff' } }
      },
      elements: {
        line: { tension: 0, spanGaps: true }
      }
    }
  });
}

function createAccelChart(ctx) {
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Ax', data: [], borderColor: '#ff4444', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 2, fill: false },
        { label: 'Ay', data: [], borderColor: '#44ff44', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 2, fill: false },
        { label: 'Az', data: [], borderColor: '#4444ff', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 2, fill: false },
        { label: 'Atotal', data: [], borderColor: '#ffcc00', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 2, fill: false }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'category',
          title: { display: true, text: 'Hora', font: { size: 12 } },
          ticks: { color: '#ffffff', font: { size: 10 } }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'gravedad (g)', font: { size: 12 } },
          ticks: { color: '#ffffff', font: { size: 10 } }
        }
      },
      plugins: {
        legend: { labels: { color: '#ffffff' } }
      },
      elements: {
        line: { tension: 0, spanGaps: true }
      }
    }
  });
}

function pushChartPoint(chart, time, values) {
  if (!chart) return;
  if (chart.data.labels.length > 50) {
    chart.data.labels.splice(0, 1);
    chart.data.datasets.forEach(ds => ds.data.splice(0, 1));
  }
  chart.data.labels.push(time);
  for (let i = 0; i < chart.data.datasets.length; i++) {
    chart.data.datasets[i].data.push(values[i] !== undefined ? values[i] : null);
  }
  chart.update();
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('show');
  }, 100);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      notification.remove();
    }, 500);
  }, 3000);
}

const temperatureChart = createLineChart(
  document.getElementById('temperatureChart').getContext('2d'),
  'Temperatura',
  'Temperatura (°C)',
  '#ff9800'
);
const humidityChart = createLineChart(
  document.getElementById('humidityChart').getContext('2d'),
  'Humedad',
  'Humedad (%)',
  '#4caf50'
);
const pressureChart = createLineChart(
  document.getElementById('pressureChart').getContext('2d'),
  'Presion',
  'Presion (hPa)',
  '#673ab7'
);
const altitudeChart = createAltitudeChart(
  document.getElementById('altitudeChart').getContext('2d')
);
const accelChart = createAccelChart(
  document.getElementById('accelChart').getContext('2d')
);
const windChart = createLineChart(
  document.getElementById('windChart').getContext('2d'),
  'Viento',
  'Viento (m/s)',
  '#00bcd4'
);
const velocityChart = createLineChart(
  document.getElementById('velocityChart').getContext('2d'),
  'Velocidad',
  'Velocidad (m/s)',
  '#ffeb3b'
);

window.api.onPayloadData((data) => {
  lastPayloadDataTime = Date.now();

  pushChartPoint(temperatureChart, data.time, [data.temperature !== undefined ? parseFloat(data.temperature) : null]);
  pushChartPoint(humidityChart, data.time, [data.humidity !== undefined ? parseFloat(data.humidity) : null]);
  pushChartPoint(pressureChart, data.time, [data.pressure !== undefined ? parseFloat(data.pressure) : null]);
  pushChartPoint(altitudeChart, data.time, [
    data.relativeAltitude !== undefined ? parseFloat(data.relativeAltitude) : null,
    data.altitude !== undefined ? parseFloat(data.altitude) : null
  ]);
  pushChartPoint(accelChart, data.time, [
    data.accelx !== undefined ? parseFloat(data.accelx) : null,
    data.accely !== undefined ? parseFloat(data.accely) : null,
    data.accelz !== undefined ? parseFloat(data.accelz) : null,
    data.atotal !== undefined ? parseFloat(data.atotal) : null
  ]);
  pushChartPoint(windChart, data.time, [data.speed !== undefined ? parseFloat(data.speed) : null]);
  pushChartPoint(velocityChart, data.time, [data.velocity !== undefined ? parseFloat(data.velocity) : null]);

  if (data.temperature !== undefined) document.getElementById('tempValue').textContent = `${data.temperature}°C`;
  if (data.humidity !== undefined) document.getElementById('humidityValue').textContent = `${data.humidity}%`;
  if (data.pressure !== undefined) document.getElementById('pressureValue').textContent = `${data.pressure} hPa`;
  if (data.atotal !== undefined) document.getElementById('accelValue').textContent = `${data.atotal} g`;
  if (data.relativeAltitude !== undefined) document.getElementById('altitudeValue').textContent = `${data.relativeAltitude} m`;
  if (data.altitude !== undefined) document.getElementById('absoluteAltitudeValue').textContent = `${data.altitude} m`;
  if (data.speed !== undefined) document.getElementById('windValue').textContent = `${data.speed} m/s`;
  if (data.velocity !== undefined) document.getElementById('velocityValue').textContent = `${data.velocity} m/s`;

  if (data.decouplingStatus) {
    showNotification('Rele activado con exito');
  }
});

window.api.onError((message) => {
  showNotification(`Error: ${message}`);
});

window.api.onReportGenerated((data) => {
  showNotification(data.message);
});

window.api.onSimulationStatus((data) => {
  showNotification(data.message);
});

window.onload = async () => {
  const select = document.getElementById('serialPortSelect');
  try {
    const ports = await window.api.listSerialPorts();
    ports.forEach(port => {
      const option = document.createElement('option');
      option.value = port.path;
      option.text = `${port.path} (${port.manufacturer || 'Desconocido'})`;
      select.appendChild(option);
    });

    select.addEventListener('change', async (e) => {
      if (e.target.value) {
        const result = await window.api.setSerialPort(e.target.value);
        if (!result.success) {
          showNotification(`Error: ${result.message}`);
        }
      }
    });
  } catch (err) {
    showNotification('Error al cargar los puertos seriales: ' + err.message);
  }
};

document.getElementById('generateReportBtn').addEventListener('click', () => {
  window.api.generateReport();
});

setInterval(() => {
  const now = Date.now();
  const threshold = 5000;

  const status = document.getElementById('payloadStatus');
  if (lastPayloadDataTime && (now - lastPayloadDataTime) < threshold) {
    status.textContent = '✅ Recibiendo datos de carga';
    status.style.color = '#00ff00';
  } else {
    status.textContent = '⚠️ No se reciben datos de carga';
    status.style.color = '#ff0000';
  }
}, 1000);
