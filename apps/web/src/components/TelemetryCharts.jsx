import { useEffect, useRef } from 'react';

const CHART_HISTORY_LIMIT = 30;

export function TelemetryCharts({ historySamples, latestTelemetry, viewState }) {
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
    </section>
  );
}
