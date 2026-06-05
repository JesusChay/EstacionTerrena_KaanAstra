import telemetryContracts from './generated/telemetry-contract.js';
import { loadLatestTelemetry } from './application/loadLatestTelemetry.js';
import { loadRecentTelemetry } from './application/loadRecentTelemetry.js';
import { prepareReportDownload } from './application/prepareReportDownload.js';
import { deriveStationStatus } from './application/deriveStationStatus.js';
import { resolveTelemetryModelState } from './application/resolveTelemetryModelState.js';
import { configureTelemetryApiConfig, getRecentLimitConfig, getReportLimitConfig } from './application/telemetryApiConfig.js';
import {
  configureTelemetryReadModel,
  formatReportValue,
  getReportExportFields,
  getReportFieldLabels,
  normalizeTelemetryRecord,
  normalizeTelemetryRecords
} from './adapters/contracts/telemetryReadModel.js';
import { createCsvReportArtifact } from './adapters/export/createCsvReportArtifact.js';
import { createChartsPresenter } from './adapters/ui/createChartsPresenter.js';
import { buildDemoTelemetry } from './adapters/ui/demoTelemetry.js';
import { createMapPresenter } from './adapters/ui/createMapPresenter.js';
import { createModelPresenter } from './adapters/ui/createModelPresenter.js';
import { createStatusPresenter } from './adapters/ui/createStatusPresenter.js';
import { downloadTextFile } from './adapters/ui/downloadTextFile.js';
import { initializeTabs } from './adapters/ui/initializeTabs.js';
import { createTelemetryApiClient } from './infrastructure/api/telemetryApiClient.js';
import { readAppConfigApiBaseUrl } from './infrastructure/browser/runtimeConfig.js';

configureTelemetryApiConfig({
  contracts: telemetryContracts,
  apiBaseUrl: readAppConfigApiBaseUrl()
});
configureTelemetryReadModel({ contracts: telemetryContracts });

const HISTORY_LIMIT = Math.min(30, getRecentLimitConfig().max);
const REFRESH_INTERVAL_MS = 500;

const apiClient = createTelemetryApiClient();
const chartsPresenter = createChartsPresenter({ historyLimit: HISTORY_LIMIT });
const mapPresenter = createMapPresenter();
const modelPresenter = createModelPresenter();
const statusPresenter = createStatusPresenter();

bootstrap();

async function bootstrap() {
  initializeTabs({
    onMapTabActivated: () => mapPresenter.invalidateSize(),
    onModelTabActivated: () => modelPresenter.handleResize()
  });

  mapPresenter.initialize();
  modelPresenter.initialize();
  modelPresenter.animate();
  statusPresenter.startClock();

  const { samples, source } = await loadRecentTelemetry({
    apiClient,
    historyLimit: HISTORY_LIMIT,
    normalizeTelemetryRecords,
    fallbackTelemetry: buildDemoTelemetry
  });

  chartsPresenter.sync(samples);
  mapPresenter.sync(samples);

  const latest = samples[samples.length - 1];
  if (latest && source === 'api') {
    renderTelemetrySnapshot(latest, 'API');
    statusPresenter.setWorkerStatus('Worker conectado', 'status-ok');
  } else {
    startDemoMode('API no disponible', samples);
  }

  globalThis.window.setInterval(refreshLatestTelemetry, REFRESH_INTERVAL_MS);
  bindUiActions();
}

function bindUiActions() {
  const downloadButton = document.getElementById('downloadReportBtn');
  if (downloadButton) {
    downloadButton.addEventListener('click', handleReportDownload);
  }

  const centerMapButton = document.getElementById('centerMapBtn');
  if (centerMapButton) {
    centerMapButton.addEventListener('click', () => mapPresenter.centerOnPayload());
  }
}

async function refreshLatestTelemetry() {
  try {
    const telemetry = await loadLatestTelemetry({ apiClient, normalizeTelemetryRecord });
    statusPresenter.setWorkerStatus('Worker conectado', 'status-ok');
    renderTelemetrySnapshot(telemetry, 'API activa');
    chartsPresenter.append(telemetry);
  } catch {
    statusPresenter.setWorkerStatus('Worker sin enlace', 'status-error');
    statusPresenter.setStationStatus('Sin datos de estacion', 'status-waiting');
  }
}

function startDemoMode(reason, samples) {
  statusPresenter.setWorkerStatus(reason, 'status-waiting');
  statusPresenter.setDataMode('Demo local');
  chartsPresenter.sync(samples);
  mapPresenter.sync(samples);
  renderTelemetrySnapshot(samples[samples.length - 1], 'Demo local', {
    label: 'Modo demo local',
    className: 'status-waiting'
  });
}

async function handleReportDownload() {
  const button = document.getElementById('downloadReportBtn');
  if (button) {
    button.disabled = true;
    button.textContent = 'Generando...';
  }

  try {
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
  } catch (error) {
    globalThis.window.alert(error.message || 'No se pudo generar el reporte.');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Descargar reporte';
    }
  }
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
  mapPresenter.updateTelemetry(telemetry);
  modelPresenter.updateTelemetry(resolveTelemetryModelState(telemetry));
}
