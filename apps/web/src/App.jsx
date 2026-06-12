import logoImage from './assets/logo.png';
import titleImage from './assets/titulo.png';
import { TelemetryCharts } from './components/TelemetryCharts.jsx';
import { TelemetryMapPanel } from './components/TelemetryMapPanel.jsx';
import { TelemetryModelPanel } from './components/TelemetryModelPanel.jsx';

export default function App({
  activeTab,
  centerMapRequest,
  centerMap: onCenterMap,
  downloadReport: onDownloadReport,
  historySamples,
  isDownloading,
  latestLandingPrediction,
  latestTelemetry,
  modelState,
  setActiveTab: onTabChange,
  viewState
}) {
  return (
    <>
      <div className="connection-status">
        <div className="connection-pills">
          <StatusPill status={viewState.stationStatus} />
          <StatusPill status={viewState.workerStatus} />
        </div>
      </div>

      <header className="banner">
        <div className="titulo">
          <img src={logoImage} alt="Logo KA'AN ASTRA" className="logo-image" />
          <div>
            <img src={titleImage} alt="KA'AN ASTRA" className="title-image" />
          </div>
        </div>

        <div className="banner-status">
          <div className="status-card">
            <span className="meta-label">Ultima muestra</span>
            <strong>{viewState.sampleTime}</strong>
          </div>
          <div className="status-card">
            <span className="meta-label">Canal activo</span>
            <strong>{viewState.sourceChannel}</strong>
          </div>
          <div className="status-card">
            <span className="meta-label">Fecha y hora local</span>
            <strong>{viewState.systemDateTime}</strong>
          </div>
        </div>
      </header>

      <main className="page-shell">
        <nav className="subtabs" aria-label="Vistas de telemetria">
          <TabButton isActive={activeTab === 'dashboard'} onClick={() => onTabChange('dashboard')}>Dashboard</TabButton>
          <TabButton isActive={activeTab === 'map'} onClick={() => onTabChange('map')}>Mapa</TabButton>
          <TabButton isActive={activeTab === 'model'} onClick={() => onTabChange('model')}>Modelo 3D</TabButton>
        </nav>

        <section className={`tab-panel tab-panel-dashboard ${activeTab === 'dashboard' ? 'is-active' : ''}`}>
          <TelemetryCharts
            historySamples={historySamples}
            latestTelemetry={latestTelemetry}
            latestLandingPrediction={latestLandingPrediction}
            viewState={viewState}
          />
        </section>

        <section className={`tab-panel ${activeTab === 'map' ? 'is-active' : ''}`}>
          <TelemetryMapPanel
            active={activeTab === 'map'}
            centerRequestKey={centerMapRequest}
            historySamples={historySamples}
            latestLandingPrediction={latestLandingPrediction}
            latestTelemetry={latestTelemetry}
            onCenterMap={onCenterMap}
            viewState={viewState}
          />
        </section>

        <section className={`tab-panel ${activeTab === 'model' ? 'is-active' : ''}`}>
          <TelemetryModelPanel
            active={activeTab === 'model'}
            latestTelemetry={latestTelemetry}
            modelState={modelState}
            viewState={viewState}
          />
        </section>
      </main>

      <div className="footer-bar">
        <span className="footer-note">Modo de datos: <strong>{viewState.sourceMode}</strong></span>
        <div className="footer-actions">
          <button id="downloadReportBtn" type="button" onClick={onDownloadReport} disabled={isDownloading}>
            {isDownloading ? 'Generando...' : 'Descargar reporte'}
          </button>
        </div>
      </div>
    </>
  );
}

function StatusPill({ status }) {
  return <span className={`status-pill ${status.className}`}>{status.label}</span>;
}

function TabButton({ children, isActive, onClick }) {
  return (
    <button type="button" className={`subtab-button ${isActive ? 'is-active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}
