const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const fs = require('fs');
const XLSX = require('xlsx');
const { createSimulationTelemetrySource } = require('./src/application/use-cases/createSimulationTelemetrySource');
const { createTelemetryProcessor } = require('./src/application/use-cases/createTelemetryProcessor');
const { generateDesktopReport } = require('./src/application/use-cases/generateDesktopReport');
const { toTelemetrySampleDto } = require('./src/adapters/contracts/toTelemetrySampleDto');
const { sendToWindow, broadcastPayloadData } = require('./src/adapters/electron/windowMessaging');
const { resolveSerialTelemetryInput } = require('./src/adapters/serial/resolveSerialTelemetryInput');
const { parseTelemetryMessage } = require('./src/adapters/serial/telemetryParser');
const { createTelemetryApiPublisher } = require('./src/infrastructure/http/createTelemetryApiPublisher');
const { createDesktopReportWriter } = require('./src/infrastructure/reporting/createDesktopReportWriter');

let dashboardWindow, mapWindow, model3dWindow;
let serialPort, parser;
let payloadDataLog = [];
let simulationInterval = null;

const TELEMETRY_API_URL = process.env.TELEMETRY_API_URL || 'https://kaan-astra-telemetry-api.adriancct13.workers.dev/api/telemetry';
const TELEMETRY_API_ENABLED = process.env.TELEMETRY_API_ENABLED !== 'false';
const TELEMETRY_PUBLISH_INTERVAL_MS = Number.parseInt(process.env.TELEMETRY_PUBLISH_INTERVAL_MS || '1000', 10);
let serialDebugEnabled = true;

const electronAdaptersDir = path.join(__dirname, 'src', 'adapters', 'electron');
const rendererDir = path.join(electronAdaptersDir, 'renderer');
const preloadPath = path.join(electronAdaptersDir, 'preload.js');

function logSerialDebug(prefix, message) {
    if (!serialDebugEnabled) return;
    console.log(`[SERIAL] ${prefix}: ${message}`);
}

function logTelemetryDebug(prefix, payload) {
    if (!serialDebugEnabled) return;
    try {
        console.log(`[PAYLOAD] ${prefix}: ${JSON.stringify(payload)}`);
    } catch (error) {
        console.log(`[PAYLOAD] ${prefix}:`, payload);
    }
}

const telemetryPublisher = createTelemetryApiPublisher({
    url: TELEMETRY_API_URL,
    enabled: TELEMETRY_API_ENABLED,
    publishIntervalMs: TELEMETRY_PUBLISH_INTERVAL_MS,
    fetchImpl: global.fetch,
    infoLogger: (message) => console.log(message),
    warnLogger: (message) => console.warn(message)
});

const desktopReportWriter = createDesktopReportWriter({
    fs,
    path,
    XLSX,
    documentsPathProvider: () => app.getPath('documents')
});

const telemetryProcessor = createTelemetryProcessor({
    parseTelemetryMessage,
    debugLogger: logTelemetryDebug,
    warnLogger: (message, payload) => {
        if (payload !== undefined) {
            console.warn(message, payload);
            return;
        }
        console.warn(message);
    },
    infoLogger: (message, payload) => {
        if (payload !== undefined) {
            console.log(message, payload);
            return;
        }
        console.log(message);
    }
});

const simulationTelemetrySource = createSimulationTelemetrySource();

function createWindows() {
    dashboardWindow = new BrowserWindow({
        width: 1200,
        height: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: preloadPath
        }
    });
    dashboardWindow.loadFile(path.join(rendererDir, 'dashboard.html'));

    dashboardWindow.on('close', () => {
        if (mapWindow) mapWindow.close();
        if (model3dWindow) model3dWindow.close();
    });

    mapWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: preloadPath
        }
    });
    mapWindow.loadFile(path.join(rendererDir, 'map.html'));

    model3dWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: preloadPath
        }
    });
    model3dWindow.loadFile(path.join(rendererDir, 'model3d.html'));
}

app.whenReady().then(() => {
    createWindows();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindows();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

function simulateData() {
    processPayloadData(simulationTelemetrySource.nextTelemetryInput());
}

function initializeSerialPort(portName, baudRate = 115200) {
    if (serialPort) {
        serialPort.close(() => {
            console.log('Puerto serial anterior cerrado');
        });
    }

    try {
        serialPort = new SerialPort({ path: portName, baudRate: parseInt(baudRate) });
        parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

        logSerialDebug('INIT', `Escuchando en ${portName} @ ${baudRate}`);

        parser.on('data', (line) => {
            const resolvedInput = resolveSerialTelemetryInput(line, {
                logSerialDebug,
                logTelemetryDebug
            });
            if (resolvedInput.type !== 'telemetry') {
                return;
            }

            processPayloadData(resolvedInput.payload);
        });

        serialPort.on('error', (err) => {
            console.error('❌ Error en el puerto serial:', err.message);
            sendToWindow(dashboardWindow, 'error', 'Error en el puerto serial: ' + err.message);
        });

        serialPort.on('close', () => {
            console.warn('⚠️ Puerto serial cerrado');
            sendToWindow(dashboardWindow, 'error', 'Puerto serial cerrado. Verifica la conexion del receptor.');
        });

        serialPort.on('open', () => {
            console.log('✅ Puerto serial abierto:', portName);
            sendToWindow(dashboardWindow, 'simulation-status', { message: `Conectado al puerto ${portName}` });
        });
    } catch (err) {
        console.error('❌ Error al inicializar el puerto:', err.message);
        sendToWindow(dashboardWindow, 'error', 'No se pudo inicializar el puerto serial: ' + portName);
    }
}

ipcMain.handle('list-serial-ports', async () => {
    try {
        const ports = await SerialPort.list();
        return ports.map(port => ({ path: port.path, manufacturer: port.manufacturer || 'Desconocido' }));
    } catch (err) {
        console.error('❌ Error al listar puertos:', err.message);
        sendToWindow(dashboardWindow, 'error', 'No se pudieron listar los puertos seriales.');
        return [];
    }
});

ipcMain.handle('set-serial-port', async (event, portName) => {
    try {
        if (portName === 'simulation') {
            if (serialPort) {
                serialPort.close(() => {
                    console.log('Puerto serial cerrado para iniciar simulación');
                });
                serialPort = null;
                parser = null;
            }
            if (simulationInterval) {
                clearInterval(simulationInterval);
            }
            simulationTelemetrySource.reset();
            simulationInterval = setInterval(simulateData, 500);
            console.log('✅ Modo simulación activado');
            return { success: true, message: 'Modo simulación activado' };
        } else {
            if (simulationInterval) {
                clearInterval(simulationInterval);
                simulationInterval = null;
                console.log('Modo simulación desactivado');
            }
            initializeSerialPort(portName);
            return { success: true, message: `Puerto ${portName} seleccionado correctamente.` };
        }
    } catch (err) {
        console.error('❌ Error al establecer el puerto:', err.message);
        sendToWindow(dashboardWindow, 'error', `No se pudo establecer el puerto ${portName}.`);
        return { success: false, message: `Error al establecer el puerto ${portName}.` };
    }
});

ipcMain.handle('set-receiver-location', async (event, coords) => {
    const { latitude, longitude } = coords || {};
    if (telemetryProcessor.setReceiverLocation(coords)) {
        console.log(`📍 Receptor ubicado en: ${latitude}, ${longitude}`);
        return { success: true };
    }
    return { success: false, message: 'Coordenadas invalidas' };
});

function processPayloadData(message) {
    const processedTelemetry = telemetryProcessor.process(message);
    if (!processedTelemetry) {
        return;
    }

    const payloadData = toTelemetrySampleDto(processedTelemetry);
    logTelemetryDebug('EMITTED', payloadData);

    payloadDataLog.push(payloadData);
    telemetryPublisher.publish(payloadData);
    broadcastPayloadData([dashboardWindow, mapWindow, model3dWindow], payloadData);
}

ipcMain.on('generate-report', () => {
    try {
        const report = generateDesktopReport({
            samples: payloadDataLog,
            reportWriter: desktopReportWriter,
            isSimulation: Boolean(simulationInterval)
        });
        console.log(`Archivo Excel guardado en: ${report.excelFilePath}`);
        console.log(`Archivo de texto guardado en: ${report.textFilePath}`);
        sendToWindow(dashboardWindow, 'report-generated', {
            message: report.message
        });
    } catch (error) {
        console.log(error.message);
        sendToWindow(dashboardWindow, 'error', error.message);
    }
});
