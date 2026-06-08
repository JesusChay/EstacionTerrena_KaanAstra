import { useCallback, useEffect, useRef, useState } from 'react';
import { bootstrapTelemetryApp } from './main.js';
import { createDefaultTelemetryViewState, mergeTelemetryViewState } from './adapters/ui/telemetryViewState.js';

export function useTelemetryApp() {
  const [viewState, setViewState] = useState(() => createDefaultTelemetryViewState());
  const [activeTab, setActiveTab] = useState('dashboard');
  const [centerMapRequest, setCenterMapRequest] = useState(0);
  const [historySamples, setHistorySamples] = useState([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [latestTelemetry, setLatestTelemetry] = useState(null);
  const [modelState, setModelState] = useState(null);
  const controllerRef = useRef(null);

  useEffect(() => {
    const controller = bootstrapTelemetryApp({
      onHistorySamplesChange: setHistorySamples,
      onLatestTelemetryChange: setLatestTelemetry,
      onModelStateChange: setModelState,
      onViewStateChange: (patch) => {
        setViewState((currentState) => mergeTelemetryViewState(currentState, patch));
      }
    });

    controllerRef.current = controller;
    controller.ready?.catch((error) => {
      globalThis.window?.alert(error.message || 'No se pudo iniciar la interfaz web.');
    });

    return () => {
      controllerRef.current = null;
      controller.teardown();
    };
  }, []);

  const centerMap = useCallback(() => {
    setCenterMapRequest((value) => value + 1);
  }, []);

  const downloadReport = useCallback(async () => {
    if (isDownloading) {
      return;
    }

    setIsDownloading(true);
    try {
      await controllerRef.current?.downloadReport?.();
    } catch (error) {
      globalThis.window?.alert(error.message || 'No se pudo generar el reporte.');
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading]);

  return {
    activeTab,
    centerMap,
    centerMapRequest,
    downloadReport,
    historySamples,
    isDownloading,
    latestTelemetry,
    modelState,
    setActiveTab,
    viewState
  };
}
