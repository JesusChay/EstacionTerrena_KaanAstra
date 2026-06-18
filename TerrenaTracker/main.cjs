const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const { parseReceiverCSV, isReceiverLine } = require("./src/infrastructure/receiverTelemetryParser.cjs");

let win;
let serialPort = null;
let parser = null;
let simulationInterval = null;

const COMPASS_DIRECTIONS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function sendPayloadData(data) {
  if (win && !win.isDestroyed()) {
    win.webContents.send("payload-data", data);
  }
}

function sendError(msg) {
  if (win && !win.isDestroyed()) {
    win.webContents.send("error", msg);
  }
}

function handleSerialLine(line) {
  if (!isReceiverLine(line)) return;
  const parsed = parseReceiverCSV(line);
  if (parsed) {
    sendPayloadData(parsed);
  }
}

function startSerialPort(portName) {
  try {
    serialPort = new SerialPort({ path: portName, baudRate: 115200 });
    parser = serialPort.pipe(new ReadlineParser({ delimiter: "\r\n" }));
    parser.on("data", handleSerialLine);
    serialPort.on("error", (err) => sendError("Serial: " + err.message));
  } catch (err) {
    sendError("No se pudo abrir " + portName + ": " + err.message);
  }
}

function stopSerialPort() {
  if (parser) {
    parser.removeListener("data", handleSerialLine);
    parser = null;
  }
  if (serialPort) {
    try { serialPort.close(); } catch (_) {}
    serialPort = null;
  }
}

const SIM_LAT = 19.4326;
const SIM_LON = -99.1332;
let simLatOffset = 0;
let simLonOffset = 0;
let simAlt = 0;
let simPhase = 0;

function startSimulation() {
  simLatOffset = 0;
  simLonOffset = 0;
  simAlt = 0;
  simPhase = 0;

  simulationInterval = setInterval(() => {
    if (simPhase === 0) {
      simAlt += 5.2;
      simLatOffset += 0.00008;
      simLonOffset += 0.00005;
      if (simAlt >= 520) simPhase = 1;
    } else {
      simAlt = Math.max(0, simAlt - 3.46);
      simLatOffset += 0.00002;
      simLonOffset += 0.00001;
    }

    const data = {
      rocket: {
        latitude: SIM_LAT + simLatOffset + (Math.random() - 0.5) * 0.0001,
        longitude: SIM_LON + simLonOffset + (Math.random() - 0.5) * 0.0001,
        altitude: simAlt
      },
      flight: {
        status: simPhase === 0 ? "FLYING" : (simAlt <= 0 ? "LANDED" : "FLYING"),
        alarm: simPhase === 1 && simAlt <= 0
      },
      signal: {
        timestamp: Date.now(),
        rssi: -70 - Math.floor(Math.random() * 30),
        snr: Math.floor(Math.random() * 15) + 5
      },
      ground: {
        latitude: SIM_LAT,
        longitude: SIM_LON
      },
      wind: {
        velocity: Math.random() * 8 + 2
      },
      compass: {
        direction: COMPASS_DIRECTIONS[Math.floor(Math.random() * 16)]
      }
    };

    sendPayloadData(data);
  }, 1000);
}

function stopSimulation() {
  if (simulationInterval) {
    clearInterval(simulationInterval);
    simulationInterval = null;
  }
}

ipcMain.handle("list-serial-ports", async () => {
  try {
    const ports = await SerialPort.list();
    return ports.map(p => ({ path: p.path, manufacturer: p.manufacturer || "" }));
  } catch {
    return [];
  }
});

ipcMain.handle("set-serial-port", async (event, portName) => {
  stopSimulation();
  stopSerialPort();

  if (portName === "simulation") {
    startSimulation();
    return "simulation";
  }

  if (portName) {
    startSerialPort(portName);
    return portName;
  }

  return null;
});

ipcMain.handle("disconnect-serial-port", async () => {
  stopSimulation();
  stopSerialPort();
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  stopSimulation();
  stopSerialPort();
  if (process.platform !== "darwin") app.quit();
});
