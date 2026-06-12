import { useEffect, useRef } from 'react';

const CHART_HISTORY_LIMIT = 30;

export function TelemetryCharts({ historySamples, latestTelemetry, latestLandingPrediction, viewState }) {
  const presenterRef = useRef(null);
  const historySamplesRef = useRef(historySamples);
  const latestTelemetryRef = useRef(latestTelemetry);
  const temperatureCanvasRef = useRef(null);
  const pressureCanvasRef = useRef(null);
  const accelCanvasRef = useRef(null);
  const altitudeCanvasRef = useRef(null);
  const windCanvasRef = useRef(null);
  const velocityCanvasRef = useRef(null);
  const distanceCanvasRef = useRef(null);

  useEffect(() => {
    historySamplesRef.current = historySamples;
  }, [historySamples]);

  useEffect(() => {
    latestTelemetryRef.current = latestTelemetry;
  }, [latestTelemetry]);

  useEffect(() => {
    let isCancelled = false;

    if (!temperatureCanvasRef.current || !pressureCanvasRef.current || !accelCanvasRef.current || !altitudeCanvasRef.current
      || !windCanvasRef.current || !velocityCanvasRef.current || !distanceCanvasRef.current) {
      return undefined;
    }

    import('../adapters/ui/createChartsPresenter.js').then(({ createChartsPresenter }) => {
      if (isCancelled) {
        return;
      }

      presenterRef.current = createChartsPresenter({
        historyLimit: CHART_HISTORY_LIMIT,
        canvasElements: {
          temperature: temperatureCanvasRef.current,
          pressure: pressureCanvasRef.current,
          accel: accelCanvasRef.current,
          altitude: altitudeCanvasRef.current,
          wind: windCanvasRef.current,
          velocity: velocityCanvasRef.current,
          distance: distanceCanvasRef.current
        }
      });

      presenterRef.current.sync(historySamplesRef.current);
    });

    return () => {
      isCancelled = true;
      presenterRef.current?.dispose?.();
      presenterRef.current = null;
    };
  }, []);

  useEffect(() => {
    presenterRef.current?.sync(historySamples);
  }, [historySamples]);

  useEffect(() => {
    if (latestTelemetry) {
      presenterRef.current?.append(latestTelemetry);
    }
  }, [latestTelemetry]);

  return (
    <section className="grid-container chart-grid">
      <article className="panel chart-panel">
        <h2>Temperatura</h2>
        <div className="chart-canvas-shell">
          <canvas ref={temperatureCanvasRef}></canvas>
        </div>
        <div className="value-label">{viewState.metrics.temperature}</div>
      </article>

      <article className="panel chart-panel">
        <h2>Presion</h2>
        <div className="chart-canvas-shell">
          <canvas ref={pressureCanvasRef}></canvas>
        </div>
        <div className="value-label">{viewState.metrics.pressure}</div>
      </article>

      <article className="panel chart-panel">
        <h2>Acelerometro</h2>
        <div className="chart-canvas-shell">
          <canvas ref={accelCanvasRef}></canvas>
        </div>
        <div className="value-label">{viewState.metrics.atotal}</div>
      </article>

      <article className="panel chart-panel">
        <h2>Altitud</h2>
        <div className="chart-canvas-shell">
          <canvas ref={altitudeCanvasRef}></canvas>
        </div>
        <div className="value-label">Relativa: <span>{viewState.metrics.relativeAltitude}</span></div>
        <div className="value-label">Absoluta: <span>{viewState.metrics.altitude}</span></div>
      </article>

      <article className="panel chart-panel">
        <h2>Viento</h2>
        <div className="chart-canvas-shell">
          <canvas ref={windCanvasRef}></canvas>
        </div>
        <div className="value-label">{viewState.metrics.wind}</div>
      </article>

      <article className="panel chart-panel">
        <h2>Velocidad</h2>
        <div className="chart-canvas-shell">
          <canvas ref={velocityCanvasRef}></canvas>
        </div>
        <div className="value-label">Horizontal: <span>{viewState.metrics.velocity}</span></div>
        <div className="value-label">Vertical: <span>{viewState.metrics.velocityZ}</span></div>
      </article>

      <article className="panel chart-panel info-panel">
        <h2>Distancia</h2>
        <div className="chart-canvas-shell">
          <canvas ref={distanceCanvasRef}></canvas>
        </div>
        <div className="value-label">Distancia a terrena: <span>{viewState.metrics.distanceToReceiver}</span></div>
        <div className="value-label">TX: <span>{viewState.metrics.latitude}</span>, <span>{viewState.metrics.longitude}</span></div>
        <div className="value-label">RX: <span>{viewState.metrics.receiverLatitude}</span>, <span>{viewState.metrics.receiverLongitude}</span></div>
      </article>

      <article className="panel chart-panel info-panel">
        <h2>Deriva</h2>
        <div className="drift-table-wrapper">
          <table className="drift-table">
            <thead>
              <tr>
                <th>Vector</th>
                <th>Norte</th>
                <th>Este</th>
                <th>Vel.</th>
                <th>Dir.</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Vel. horizontal (GPS)</td>
                <td>{formatDriftValue(latestLandingPrediction?.horizontalVelocityVector?.northMps)}</td>
                <td>{formatDriftValue(latestLandingPrediction?.horizontalVelocityVector?.eastMps)}</td>
                <td>{formatDriftValue(latestLandingPrediction?.horizontalVelocityVector?.speedMps)}</td>
                <td>{formatDirection(latestLandingPrediction?.horizontalVelocityVector?.directionDeg)}</td>
              </tr>
              <tr>
                <td>Deriva fusionada</td>
                <td>{formatDriftValue(latestLandingPrediction?.blendedDriftVector?.northMps)}</td>
                <td>{formatDriftValue(latestLandingPrediction?.blendedDriftVector?.eastMps)}</td>
                <td>{formatDriftValue(latestLandingPrediction?.blendedDriftVector?.speedMps)}</td>
                <td>{formatDirection(latestLandingPrediction?.blendedDriftVector?.directionDeg)}</td>
              </tr>
              <tr>
                <td>Viento modelado</td>
                <td>{formatDriftValue(latestLandingPrediction?.windVector?.northMps)}</td>
                <td>{formatDriftValue(latestLandingPrediction?.windVector?.eastMps)}</td>
                <td>{formatDriftValue(latestLandingPrediction?.windVector?.speedMps)}</td>
                <td>{formatDirection(latestLandingPrediction?.windVector?.directionDeg)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="drift-source">Fuente: <span>{formatWindSource(latestLandingPrediction?.windProfileSource)}</span></div>
      </article>
    </section>
  );
}

function formatDriftValue(value) {
  return Number.isFinite(value) ? `${value.toFixed(3)}` : '--';
}

function formatDirection(degrees) {
  return Number.isFinite(degrees) ? `${degrees.toFixed(1)}°` : '--';
}

function formatWindSource(source) {
  if (source === 'open-meteo') return 'Open-Meteo';
  if (source === 'static-fallback') return 'Respaldo estatico';
  if (source === 'static') return 'Perfil estatico';
  return 'Sin perfil';
}
