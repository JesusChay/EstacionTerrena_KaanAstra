const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const fs = require('fs');
const XLSX = require('xlsx');
const { createSimulationTelemetrySource } = require('./application/use-cases/createSimulationTelemetrySource');
const { createTelemetryProcessor } = require('./application/use-cases/createTelemetryProcessor');
const { generateDesktopReport } = require('./application/use-cases/generateDesktopReport');
const { toTelemetrySampleDto } = require('./adapters/contracts/toTelemetrySampleDto');
const { sendToWindow, broadcastPayloadData } = require('./adapters/electron/windowMessaging');
const { resolveSerialTelemetryInput } = require('./adapters/serial/resolveSerialTelemetryInput');
const { parseTelemetryMessage } = require('./adapters/serial/telemetryParser');
const { createTelemetryApiPublisher } = require('./infrastructure/http/createTelemetryApiPublisher');
const { createSystemReceiverLocationTracker } = require('./infrastructure/location/createSystemReceiverLocationTracker');
const { createDesktopReportWriter } = require('./infrastructure/reporting/createDesktopReportWriter');

let dashboardWindow, mapWindow, model3dWindow;
let serialPort, parser;
let payloadDataLog = [];
let simulationInterval = null;

const TELEMETRY_API_URL = process.env.TELEMETRY_API_URL || 'https://kaan-astra-telemetry-api.adriancct13.workers.dev/api/telemetry';
const TELEMETRY_API_ENABLED = process.env.TELEMETRY_API_ENABLED !== 'false';
const TELEMETRY_PUBLISH_INTERVAL_MS = Number.parseInt(process.env.TELEMETRY_PUBLISH_INTERVAL_MS || '1000', 10);
let serialDebugEnabled = true;

const dotenv = loadDotenv();

const GOOGLE_GEOLOCATION_API_KEY = process.env.GOOGLE_GEOLOCATION_API_KEY || dotenv.GOOGLE_GEOLOCATION_API_KEY;

const electronAdaptersDir = path.join(__dirname, 'adapters', 'electron');
const rendererDir = path.join(electronAdaptersDir, 'renderer');
const preloadPath = path.join(electronAdaptersDir, 'preload.js');
const LOCATION_STATUS_CHANNEL = 'receiver-location';
let latestReceiverLocationState = {
    status: 'searching',
    message: 'buscando ubicacion del sistema...'
};

function loadDotenv() {
    try {
        const envPath = path.join(__dirname, '..', '.env');
        const content = fs.readFileSync(envPath, 'utf8');
        const vars = {};
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
            const sep = trimmed.indexOf('=');
            vars[trimmed.slice(0, sep).trim()] = trimmed.slice(sep + 1).trim();
        }
        return vars;
    } catch {
        return {};
    }
}

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
    documentsPathProvider: () => app.getPath('downloads')
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

const GOOGLE_GEOLOCATION_URL = 'https://www.googleapis.com/geolocation/v1/geolocate';
const GOOGLE_GEOLOCATION_TIMEOUT_MS = 10000;

if (!GOOGLE_GEOLOCATION_API_KEY) {
    console.warn('⚠️  GOOGLE_GEOLOCATION_API_KEY no configurada — se usara geolocalizacion por IP');
}

function createGoogleLocationReader() {
    return async function readLocationViaGoogle() {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), GOOGLE_GEOLOCATION_TIMEOUT_MS);

        try {
            const response = await fetch(`${GOOGLE_GEOLOCATION_URL}?key=${GOOGLE_GEOLOCATION_API_KEY}`, {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ considerIp: true })
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`GOOGLE_API_ERROR: ${response.status} ${text}`);
            }

            const data = await response.json();
            if (!data.location || !Number.isFinite(data.location.lat) || !Number.isFinite(data.location.lng)) {
                throw new Error('LOCATION_INVALID_COORDINATES');
            }

            return {
                latitude: data.location.lat,
                longitude: data.location.lng,
                accuracy: Number.isFinite(data.accuracy) ? data.accuracy : undefined
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('LOCATION_TIMEOUT');
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    };
}

const simulationTelemetrySource = createSimulationTelemetrySource();
const receiverLocationTracker = createSystemReceiverLocationTracker({
    locationReader: GOOGLE_GEOLOCATION_API_KEY ? createGoogleLocationReader() : null,
    onLocation: handleSystemReceiverLocation,
    onStatus: broadcastReceiverLocationState,
    infoLogger: (message) => console.log(message),
    warnLogger: (message) => console.warn(message)
});

function createWindows() {
    dashboardWindow = new BrowserWindow({
        width: 1200,
        height: 700,
        webPreferences: {
            backgroundThrottling: false,
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: preloadPath
        }
    });
    dashboardWindow.loadFile(path.join(rendererDir, 'dashboard.html'));
    dashboardWindow.webContents.once('did-finish-load', () => {
        sendToWindow(dashboardWindow, LOCATION_STATUS_CHANNEL, latestReceiverLocationState);
    });

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
    mapWindow.webContents.once('did-finish-load', () => {
        sendToWindow(mapWindow, LOCATION_STATUS_CHANNEL, latestReceiverLocationState);
    });

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
    model3dWindow.webContents.once('did-finish-load', () => {
        sendToWindow(model3dWindow, LOCATION_STATUS_CHANNEL, latestReceiverLocationState);
    });
}

app.whenReady().then(() => {
    createWindows();
    receiverLocationTracker.start();
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
        const receiverLocation = telemetryProcessor.getReceiverLocation();
        if (receiverLocation) {
            broadcastReceiverLocationState({
                status: 'active',
                message: 'ubicacion activa',
                ...receiverLocation,
                updatedAt: new Date().toISOString()
            });
        }
        return { success: true, receiverLocation };
    }
    return { success: false, message: 'Coordenadas invalidas' };
});

ipcMain.handle('open-location-settings', async () => {
    if (process.platform === 'win32') {
        await shell.openExternal('ms-settings:privacy-location');
        return { success: true };
    }

    if (process.platform === 'darwin') {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices');
        return { success: true };
    }

    return { success: false, message: 'Atajo de configuracion no disponible en esta plataforma' };
});

ipcMain.handle('refresh-receiver-location', async () => {
    await receiverLocationTracker.refresh();
    return { success: true };
});

function processPayloadData(message) {
    const processedTelemetry = telemetryProcessor.process(message);
    if (!processedTelemetry) {
        return;
    }

    const payloadData = toTelemetrySampleDto(processedTelemetry);
    logTelemetryDebug('EMITTED', payloadData);

    payloadDataLog.push({ ...payloadData, receivedAt: new Date().toISOString() });
    telemetryPublisher.publish(payloadData);
    broadcastPayloadData([dashboardWindow, mapWindow, model3dWindow], payloadData);
}

function broadcastReceiverLocationState(receiverLocationState) {
    latestReceiverLocationState = { ...receiverLocationState };
    [dashboardWindow, mapWindow, model3dWindow].forEach((window) => {
        sendToWindow(window, LOCATION_STATUS_CHANNEL, latestReceiverLocationState);
    });
}

function handleSystemReceiverLocation(receiverLocation) {
    if (!telemetryProcessor.setReceiverLocation(receiverLocation)) {
        broadcastReceiverLocationState({
            status: 'error',
            message: 'coordenadas invalidas del proveedor del sistema'
        });
        return;
    }

    const activeLocation = telemetryProcessor.getReceiverLocation();
    if (!activeLocation) {
        return;
    }

    const isFallback = receiverLocation.fromFallback === true;
    const isLowAccuracy = Number.isFinite(receiverLocation.accuracy) && receiverLocation.accuracy > 150;

    let status;
    let message;

    if (isFallback) {
        status = 'low_accuracy';
        message = 'ubicacion aproximada por IP — baja precision';
    } else if (isLowAccuracy) {
        status = 'low_accuracy';
        message = 'ubicacion activa con precision baja';
    } else {
        status = 'active';
        message = 'ubicacion activa';
    }

    broadcastReceiverLocationState({
        status,
        message,
        ...activeLocation,
        accuracy: receiverLocation.accuracy,
        updatedAt: new Date().toISOString()
    });
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
