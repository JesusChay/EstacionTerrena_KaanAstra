import { useEffect, useRef } from 'react';

export function TelemetryModelPanel({ active, modelState, viewState }) {
  const presenterRef = useRef(null);
  const containerRef = useRef(null);
  const modelStateRef = useRef(modelState);
  const loadPromiseRef = useRef(null);

  useEffect(() => {
    modelStateRef.current = modelState;
  }, [modelState]);

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
    const loadPromise = import('../adapters/ui/createModelPresenter.js')
      .then(({ createModelPresenter }) => {
        if (isCancelled || !containerRef.current) {
          return;
        }

        const presenter = createModelPresenter({ containerElement: containerRef.current });
        presenter.initialize();
        presenter.animate();
        if (modelStateRef.current) {
          presenter.updateTelemetry(modelStateRef.current);
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
    if (modelState) {
      presenterRef.current?.updateTelemetry(modelState);
    }
  }, [modelState]);

  useEffect(() => {
    if (active) {
      presenterRef.current?.handleResize();
    }
  }, [active]);

  return (
    <article className="panel immersive-panel model-panel">
      <div className="panel-header-row">
        <h2>Modelo 3D</h2>
        <span className="panel-chip">Orientacion estimada</span>
      </div>
      <div ref={containerRef} className="model-surface"></div>
      <div className="gyro-strip">
        <span>{viewState.model.gyroX}</span>
        <span>{viewState.model.gyroY}</span>
        <span>{viewState.model.gyroZ}</span>
      </div>
    </article>
  );
}
