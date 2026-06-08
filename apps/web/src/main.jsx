import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { useTelemetryApp } from './useTelemetryApp.js';
import './styles.css';

function WebAppRoot() {
  const telemetryApp = useTelemetryApp();
  return <App {...telemetryApp} />;
}

createRoot(document.getElementById('root')).render(<WebAppRoot />);
