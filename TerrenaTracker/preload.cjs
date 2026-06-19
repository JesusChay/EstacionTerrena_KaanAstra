const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  listSerialPorts: () => ipcRenderer.invoke("list-serial-ports"),
  setSerialPort: (portName) => ipcRenderer.invoke("set-serial-port", portName),
  disconnectSerialPort: () => ipcRenderer.invoke("disconnect-serial-port"),
  onPayloadData: (callback) => {
    ipcRenderer.on("payload-data", (event, data) => callback(data));
  },
  onError: (callback) => {
    ipcRenderer.on("error", (event, msg) => callback(msg));
  }
});
