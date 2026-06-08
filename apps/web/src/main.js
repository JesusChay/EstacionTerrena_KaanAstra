import telemetryContracts from './generated/telemetry-contract.js';
import { loadLatestTelemetry } from './application/loadLatestTelemetry.js';
import { loadRecentTelemetry } from './application/loadRecentTelemetry.js';
import { prepareReportDownload } from './application/prepareReportDownload.js';
import { deriveStationStatus } from './application/deriveStationStatus.js';
import { resolveTelemetryModelState } from './application/resolveTelemetryModelState.js';
import {
  configureTelemetryReadModel,
  formatReportValue,
  getReportExportFields,
  getReportFieldLabels,
  normalizeTelemetryRecord,
  normalizeTelemetryRecords
} from './adapters/contracts/telemetryReadModel.js';
import { createCsvReportArtifact } from './adapters/export/createCsvReportArtifact.js';
import { buildDemoTelemetry } from './adapters/ui/demoTelemetry.js';
import { createStatusPresenter } from './adapters/ui/createStatusPresenter.js';
import { downloadTextFile } from './adapters/ui/downloadTextFile.js';
import { createModelViewState } from './adapters/ui/telemetryViewState.js';
import { configureTelemetryApiConfig, getRecentLimitConfig, getReportLimitConfig } from './infrastructure/api/telemetryApiConfig.js';
import { createTelemetryApiClient } from './infrastructure/api/telemetryApiClient.js';

configureTelemetryApiConfig({
  contracts: telemetryContracts
});
configureTelemetryReadModel({ contracts: telemetryContracts });

const HISTORY_LIMIT = Math.min(30, getRecentLimitConfig().max);
const REFRESH_INTERVAL_MS = 500;

let bootstrapController = null;

export function bootstrapTelemetryApp({
  onHistorySamplesChange = () => {},
  onLatestTelemetryChange = () => {},
  onModelStateChange = () => {},
  onViewStateChange = () => {}
} = {}) {
  if (bootstrapController) {
    return bootstrapController;
  }

  const apiClient = createTelemetryApiClient();
  const statusPresenter = createStatusPresenter({ onViewStateChange });

  let refreshIntervalId = null;
  let clockIntervalId = null;

  function teardown() {
    if (refreshIntervalId !== null) {
      globalThis.window?.clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    }

    if (clockIntervalId !== null) {
      globalThis.window?.clearInterval(clockIntervalId);
      clockIntervalId = null;
    }

    bootstrapController = null;
  }

  async function bootstrap() {
    clockIntervalId = statusPresenter.startClock();

    const { samples, source } = await loadRecentTelemetry({
      apiClient,
      historyLimit: HISTORY_LIMIT,
      normalizeTelemetryRecords,
      fallbackTelemetry: buildDemoTelemetry
    });

    onHistorySamplesChange(samples);

    const latest = samples[samples.length - 1];
    if (latest && source === 'api') {
      renderTelemetrySnapshot(latest, 'API');
      statusPresenter.setWorkerStatus('Worker conectado', 'status-ok');
    } else {
      startDemoMode('API no disponible', samples);
    }

    refreshIntervalId = globalThis.window?.setInterval(refreshLatestTelemetry, REFRESH_INTERVAL_MS) || null;
  }

  async function refreshLatestTelemetry() {
    try {
      const telemetry = await loadLatestTelemetry({ apiClient, normalizeTelemetryRecord });
      statusPresenter.setWorkerStatus('Worker conectado', 'status-ok');
      renderTelemetrySnapshot(telemetry, 'API activa');
    } catch {
      statusPresenter.setWorkerStatus('Worker sin enlace', 'status-error');
      statusPresenter.setStationStatus('Sin datos de estacion', 'status-waiting');
    }
  }

  function startDemoMode(reason, samples) {
    statusPresenter.setWorkerStatus(reason, 'status-waiting');
    statusPresenter.setDataMode('Demo local');
    onHistorySamplesChange(samples);
    renderTelemetrySnapshot(samples[samples.length - 1], 'Demo local', {
      label: 'Modo demo local',
      className: 'status-waiting'
    });
  }

  async function downloadReport() {
    const report = await prepareReportDownload({
      apiClient,
      reportLimit: getReportLimitConfig().max,
      normalizeTelemetryRecords,
      createReportArtifact: ({ rows, generatedAt }) => createCsvReportArtifact({
        rows,
        generatedAt,
        reportFields: getReportExportFields(),
        fieldLabels: getReportFieldLabels(),
        formatReportValue
      })
    });

    downloadTextFile({
      content: report.content,
      fileName: report.fileName
    });

    return report;
  }

  function renderTelemetrySnapshot(telemetry, sourceMode, stationStatusOverride) {
    if (!telemetry) {
      return;
    }

    statusPresenter.renderTelemetry({
      telemetry,
      sourceMode,
      stationStatus: stationStatusOverride || deriveStationStatus(telemetry)
    });

    onLatestTelemetryChange(telemetry);

    const modelState = resolveTelemetryModelState(telemetry);
    onModelStateChange(modelState);
    onViewStateChange({ model: createModelViewState(modelState) });
  }

  const controller = {
    downloadReport,
    ready: null,
    teardown
  };

  bootstrapController = controller;
  controller.ready = bootstrap().catch((error) => {
    teardown();
    throw error;
  });

  return controller;
}
