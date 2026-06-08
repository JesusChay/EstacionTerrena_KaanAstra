import { useEffect, useRef } from 'react';

export function TelemetryMapPanel({ active, centerRequestKey, historySamples, latestTelemetry, onCenterMap, viewState }) {
  const presenterRef = useRef(null);
  const containerRef = useRef(null);
  const historySamplesRef = useRef(historySamples);
  const latestTelemetryRef = useRef(latestTelemetry);
  const loadPromiseRef = useRef(null);

  useEffect(() => {
    historySamplesRef.current = historySamples;
  }, [historySamples]);

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
          <span className="panel-chip">Trayectoria y posicion actual</span>
          <button type="button" className="panel-action" onClick={onCenterMap}>Centrar carga</button>
        </div>
      </div>
      <div className="map-info-row">
        <span>Latitud: <strong>{viewState.map.latitude}</strong></span>
        <span>Longitud: <strong>{viewState.map.longitude}</strong></span>
        <span>Distancia: <strong>{viewState.map.distance}</strong></span>
      </div>
      <div ref={containerRef} className="map-surface"></div>
    </article>
  );
}
