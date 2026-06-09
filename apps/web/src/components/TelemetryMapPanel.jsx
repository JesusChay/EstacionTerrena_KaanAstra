import { useEffect, useRef } from 'react';

export function TelemetryMapPanel({ active, centerRequestKey, historySamples, latestLandingPrediction, latestTelemetry, onCenterMap, viewState }) {
  const presenterRef = useRef(null);
  const containerRef = useRef(null);
  const historySamplesRef = useRef(historySamples);
  const latestLandingPredictionRef = useRef(latestLandingPrediction);
  const latestTelemetryRef = useRef(latestTelemetry);
  const loadPromiseRef = useRef(null);

  useEffect(() => {
    historySamplesRef.current = historySamples;
  }, [historySamples]);

  useEffect(() => {
    latestLandingPredictionRef.current = latestLandingPrediction;
  }, [latestLandingPrediction]);

  useEffect(() => {
    latestTelemetryRef.current = latestTelemetry;
  }, [latestTelemetry]);

  useEffect(() => {
    return () => {
      presenterRef.current?.dispose?.();
      presenterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!active || presenterRef.current || loadPromiseRef.current || !containerRef.current) {
      return undefined;
    }

    let isCancelled = false;
    const loadPromise = import('../adapters/ui/createMapPresenter.js')
      .then(({ createMapPresenter }) => {
        if (isCancelled || !containerRef.current) {
          return;
        }

        const presenter = createMapPresenter({ containerElement: containerRef.current });
        presenter.initialize();
        presenter.sync(historySamplesRef.current);
        presenter.updateLandingPrediction(latestLandingPredictionRef.current);
        if (latestTelemetryRef.current) {
          presenter.updateTelemetry(latestTelemetryRef.current);
        }
        presenterRef.current = presenter;
      })
      .finally(() => {
        if (loadPromiseRef.current === loadPromise) {
          loadPromiseRef.current = null;
        }
      });

    loadPromiseRef.current = loadPromise;

    return () => {
      isCancelled = true;
    };
  }, [active]);

  useEffect(() => {
    presenterRef.current?.sync(historySamples);
  }, [historySamples]);

  useEffect(() => {
    presenterRef.current?.updateLandingPrediction(latestLandingPrediction);
  }, [latestLandingPrediction]);

  useEffect(() => {
    if (latestTelemetry) {
      presenterRef.current?.updateTelemetry(latestTelemetry);
    }
  }, [latestTelemetry]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const timeoutId = globalThis.window?.setTimeout(() => {
      presenterRef.current?.invalidateSize();
    }, 50);

    return () => {
      if (timeoutId) {
        globalThis.window?.clearTimeout(timeoutId);
      }
    };
  }, [active]);

  useEffect(() => {
    if (centerRequestKey > 0) {
      presenterRef.current?.centerOnPayload();
    }
  }, [centerRequestKey]);

  return (
    <article className="panel immersive-panel">
      <div className="panel-header-row">
        <h2>Mapa</h2>
        <div className="panel-tools">
          <span className="panel-chip">Trayectoria real y prediccion de caida</span>
          <button type="button" className="panel-action" onClick={onCenterMap}>Centrar carga</button>
        </div>
      </div>
      <div className="map-info-row">
        <span>Latitud: <strong>{viewState.map.latitude}</strong></span>
        <span>Longitud: <strong>{viewState.map.longitude}</strong></span>
        <span>Distancia: <strong>{viewState.map.distance}</strong></span>
      </div>
      <div className="prediction-info-row">
        <span>Fase: <strong>{formatPredictionPhase(latestLandingPrediction)}</strong></span>
        <span>ETA: <strong>{formatEta(latestLandingPrediction?.etaSeconds)}</strong></span>
        <span>Confianza: <strong>{formatConfidence(latestLandingPrediction?.confidence)}</strong></span>
        <span>Impacto: <strong>{formatLandingPoint(latestLandingPrediction?.predictedLanding)}</strong></span>
        <span>Viento: <strong>{formatWindSource(latestLandingPrediction?.windProfileSource)}</strong></span>
      </div>
      <div ref={containerRef} className="map-surface"></div>
    </article>
  );
}

function formatConfidence(confidence) {
  if (confidence === 'high') return 'Alta';
  if (confidence === 'medium') return 'Media';
  return 'Baja';
}

function formatEta(etaSeconds) {
  return Number.isFinite(etaSeconds) ? `${etaSeconds.toFixed(1)} s` : '--';
}

function formatLandingPoint(location) {
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    return 'Sin datos';
  }

  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
}

function formatPredictionPhase(prediction) {
  if (prediction?.status === 'landed') return 'Aterrizado';
  if (prediction?.phase === 'deployed') return 'Desplegado';
  if (prediction?.phase === 'predeploy') return 'Sin desplegar';
  return 'Esperando';
}

function formatWindSource(source) {
  if (source === 'open-meteo') return 'Open-Meteo';
  if (source === 'static-fallback') return 'Respaldo estatico';
  if (source === 'static') return 'Perfil estatico';
  return 'Sin perfil';
}
