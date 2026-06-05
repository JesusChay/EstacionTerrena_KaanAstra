import { asNumber } from './formatters.js';

export function createChartsPresenter({ historyLimit }) {
  const ChartLibrary = globalThis.window?.Chart;
  const chartState = {
    labels: [],
    temperature: [],
    pressure: [],
    distanceToReceiver: [],
    atotal: [],
    relativeAltitude: [],
    altitude: [],
    wind: [],
    velocity: [],
    velocityZ: []
  };

  const charts = {
    temperature: buildChart(ChartLibrary, 'temperatureChart', [{ label: 'Temperatura', color: '#ff9f40', key: 'temperature' }]),
    pressure: buildChart(ChartLibrary, 'pressureChart', [{ label: 'Presion', color: '#36a2eb', key: 'pressure' }]),
    distance: buildChart(ChartLibrary, 'distanceChart', [{ label: 'Distancia', color: '#ff7043', key: 'distanceToReceiver' }]),
    accel: buildChart(ChartLibrary, 'accelChart', [{ label: 'Aceleracion total', color: '#9966ff', key: 'atotal' }]),
    altitude: buildChart(ChartLibrary, 'altitudeChart', [
      { label: 'Altitud relativa', color: '#ffcd56', key: 'relativeAltitude' },
      { label: 'Altitud absoluta', color: '#ff6384', key: 'altitude' }
    ]),
    wind: buildChart(ChartLibrary, 'windChart', [{ label: 'Viento', color: '#4bc0c0', key: 'wind' }]),
    velocity: buildChart(ChartLibrary, 'velocityChart', [
      { label: 'Velocidad', color: '#36a2eb', key: 'velocity' },
      { label: 'Velocidad Z', color: '#ff6384', key: 'velocityZ' }
    ])
  };

  function sync(samples) {
    resetChartState();
    samples.forEach(pushTelemetryPoint);
    updateCharts();
  }

  function append(sample) {
    if (!sample) return;
    const time = sample.time || new Date().toLocaleTimeString('es-MX', { hour12: false });
    if (chartState.labels[chartState.labels.length - 1] === time) {
      return;
    }

    pushTelemetryPoint(sample);
    trimChartState();
    updateCharts();
  }

  function pushTelemetryPoint(sample) {
    chartState.labels.push(sample.time || '--:--:--');
    chartState.temperature.push(asNumber(sample.temperature));
    chartState.pressure.push(asNumber(sample.pressure));
    chartState.distanceToReceiver.push(asNumber(sample.distanceToReceiver));
    chartState.atotal.push(asNumber(sample.atotal));
    chartState.relativeAltitude.push(asNumber(sample.relativeAltitude));
    chartState.altitude.push(asNumber(sample.altitude));
    chartState.wind.push(asNumber(sample.speed));
    chartState.velocity.push(asNumber(sample.velocity));
    chartState.velocityZ.push(asNumber(sample.velocityZ));
  }

  function trimChartState() {
    while (chartState.labels.length > historyLimit) {
      Object.keys(chartState).forEach((key) => chartState[key].shift());
    }
  }

  function updateCharts() {
    Object.values(charts).forEach(({ chart, series }) => {
      if (!chart) return;
      chart.data.labels = [...chartState.labels];
      series.forEach((entry, index) => {
        chart.data.datasets[index].data = [...chartState[entry.key]];
      });
      chart.update();
    });
  }

  function resetChartState() {
    Object.keys(chartState).forEach((key) => {
      chartState[key] = [];
    });
  }

  return {
    sync,
    append
  };
}

function buildChart(ChartLibrary, elementId, series) {
  if (!ChartLibrary) {
    return { chart: null, series };
  }

  return {
    chart: new ChartLibrary(document.getElementById(elementId), {
      type: 'line',
      data: {
        labels: [],
        datasets: series.map((entry) => createDataset(entry.label, entry.color))
      },
      options: buildChartOptions()
    }),
    series
  };
}

function createDataset(label, color) {
  return {
    label,
    data: [],
    borderColor: color,
    backgroundColor: `${color}22`,
    tension: 0.3,
    borderWidth: 2,
    pointRadius: 1.5,
    pointHoverRadius: 3,
    fill: false
  };
}

function buildChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        labels: {
          color: '#f3fbff',
          boxWidth: 10,
          font: {
            family: 'Arial',
            size: 10
          }
        }
      }
    },
    scales: {
      x: {
        ticks: { color: '#c8d9dd', font: { size: 9 } },
        grid: { color: 'rgba(255,255,255,0.06)' }
      },
      y: {
        ticks: { color: '#c8d9dd', font: { size: 9 } },
        grid: { color: 'rgba(255,255,255,0.06)' }
      }
    }
  };
}
