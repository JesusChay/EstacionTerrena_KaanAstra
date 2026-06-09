const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onLandingPrediction: (callback) => ipcRenderer.on('landing-prediction', (event, data) => callback(data)),
  onPayloadData: (callback) => ipcRenderer.on('payload-data', (event, data) => callback(data)),
  onReceiverLocation: (callback) => ipcRenderer.on('receiver-location', (event, data) => callback(data)),
  onError: (callback) => ipcRenderer.on('error', (event, message) => callback(message)),
  onReportGenerated: (callback) => ipcRenderer.on('report-generated', (event, data) => callback(data)),
  onSimulationStatus: (callback) => ipcRenderer.on('simulation-status', (event, data) => callback(data)),
  generateReport: () => ipcRenderer.send('generate-report'),
  listSerialPorts: () => ipcRenderer.invoke('list-serial-ports'),
  openLocationSettings: () => ipcRenderer.invoke('open-location-settings'),
  refreshReceiverLocation: () => ipcRenderer.invoke('refresh-receiver-location'),
  setSerialPort: (portName) => ipcRenderer.invoke('set-serial-port', portName),
  setReceiverLocation: (coords) => ipcRenderer.invoke('set-receiver-location', coords)
});
