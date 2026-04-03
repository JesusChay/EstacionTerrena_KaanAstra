const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onPayloadData: (callback) => ipcRenderer.on('payload-data', (event, data) => callback(data)),
  // Backwards-compat (pre-refactor). Prefer onPayloadData.
  onPrimaryData: (callback) => ipcRenderer.on('payload-data', (event, data) => callback(data)),
  onSecondaryData: (callback) => ipcRenderer.on('payload-data', (event, data) => callback(data)),
  onError: (callback) => ipcRenderer.on('error', (event, message) => callback(message)),
  onReportGenerated: (callback) => ipcRenderer.on('report-generated', (event, data) => callback(data)),
  onSimulationStatus: (callback) => ipcRenderer.on('simulation-status', (event, data) => callback(data)),
  generateReport: () => ipcRenderer.send('generate-report'),
  listSerialPorts: () => ipcRenderer.invoke('list-serial-ports'),
  setSerialPort: (portName) => ipcRenderer.invoke('set-serial-port', portName)
});
