const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const fs = require('fs');
const XLSX = require('xlsx');
const { createSimulationTelemetrySource } = require('./application/use-cases/createSimulationTelemetrySource');
const { createLandingPredictionService } = require('./application/use-cases/createLandingPredictionService');
const { createTelemetryProcessor } = require('./application/use-cases/createTelemetryProcessor');
const { generateDesktopReport } = require('./application/use-cases/generateDesktopReport');
const { toLandingPredictionDto } = require('./adapters/contracts/toLandingPredictionDto');
const { toTelemetrySampleDto } = require('./adapters/contracts/toTelemetrySampleDto');
const { sendToWindow, broadcastLandingPrediction, broadcastPayloadData } = require('./adapters/electron/windowMessaging');
const { resolveSerialTelemetryInput } = require('./adapters/serial/resolveSerialTelemetryInput');
const { parseTelemetryMessage } = require('./adapters/serial/telemetryParser');
const { createLandingPredictionApiPublisher } = require('./infrastructure/http/createLandingPredictionApiPublisher');
const { createTelemetryApiPublisher } = require('./infrastructure/http/createTelemetryApiPublisher');
const { createOpenMeteoClient } = require('./infrastructure/weather/createOpenMeteoClient');
const { createOpenMeteoWindProfileProvider } = require('./infrastructure/weather/createOpenMeteoWindProfileProvider');
const { createDesktopReportWriter } = require('./infrastructure/reporting/createDesktopReportWriter');
const { createStaticWindProfileProvider } = require('./infrastructure/weather/createStaticWindProfileProvider');
const { calculateDistance } = require('./domain/telemetry/telemetryMath');

let dashboardWindow, mapWindow, model3dWindow;
let serialPort, parser;
let payloadDataLog = [];
let latestLandingPrediction = null;
let latestLandingPredictionDto = null;
let simulationInterval = null;
let missionMode = false;
let missionCommandSentToFirmware = false;
let lastLoRaEmitTime = 0;
const TELEMETRY_DEDUP_MS = 3000;

const TELEMETRY_API_URL = process.env.TELEMETRY_API_URL || 'https://kaan-astra-telemetry-api.adriancct13.workers.dev/api/telemetry';
const TELEMETRY_API_ENABLED = process.env.TELEMETRY_API_ENABLED !== 'false';
const TELEMETRY_PUBLISH_INTERVAL_MS = Number.parseInt(process.env.TELEMETRY_PUBLISH_INTERVAL_MS || '1000', 10);
const LANDING_PREDICTION_API_ENABLED = process.env.LANDING_PREDICTION_API_ENABLED !== 'false';
const LANDING_PREDICTION_API_URL = process.env.LANDING_PREDICTION_API_URL || TELEMETRY_API_URL.replace(/\/telemetry\/?$/, '/predictions');
const LANDING_PREDICTION_PUBLISH_INTERVAL_MS = Number.parseInt(process.env.LANDING_PREDICTION_PUBLISH_INTERVAL_MS || '1000', 10);
const OPEN_METEO_API_BASE_URL = process.env.OPEN_METEO_API_BASE_URL || 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_API_ENABLED = process.env.OPEN_METEO_API_ENABLED !== 'false';
const OPEN_METEO_COORDINATE_THRESHOLD_METERS = Number.parseInt(process.env.OPEN_METEO_COORDINATE_THRESHOLD_METERS || '750', 10);
const OPEN_METEO_MODELS = process.env.OPEN_METEO_MODELS;
const OPEN_METEO_REFRESH_INTERVAL_MS = Number.parseInt(process.env.OPEN_METEO_REFRESH_INTERVAL_MS || '900000', 10);
let serialDebugEnabled = true;

const electronAdaptersDir = path.join(__dirname, 'adapters', 'electron');
const rendererDir = path.join(electronAdaptersDir, 'renderer');
const preloadPath = path.join(electronAdaptersDir, 'preload.js');
const LOCATION_STATUS_CHANNEL = 'receiver-location';
let latestReceiverLocationState = {
    status: 'searching',
    message: 'buscando ubicacion del sistema...'
};

const GROUND_GPS_PATH = path.join(__dirname, '..', 'ground-gps.json');

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

function normalizeUsbIdentifier(value) {
    return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function resolveSerialPortDisplayName(port) {
    const vendorId = normalizeUsbIdentifier(port.vendorId);
    const productId = normalizeUsbIdentifier(port.productId);
    const pnpId = normalizeUsbIdentifier(port.pnpId);
    const manufacturer = typeof port.manufacturer === 'string' ? port.manufacturer.trim() : '';

    const isEspressifDevice = vendorId === '303A' || pnpId.includes('VID_303A');
    if (isEspressifDevice) {
        if (productId === '1001' || pnpId.includes('PID_1001')) {
            return 'ESP32-S3 USB JTAG/Serial';
        }

        return 'ESP32-S3 USB';
    }

    return manufacturer || 'Desconocido';
}

function formatSerialPortDetails(port) {
    const vendorId = normalizeUsbIdentifier(port.vendorId);
    const productId = normalizeUsbIdentifier(port.productId);

    if (!vendorId && !productId) {
        return '';
    }

    return `VID:${vendorId || '????'} PID:${productId || '????'}`;
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

const simulationTelemetrySource = createSimulationTelemetrySource();
const landingPredictionPublisher = createLandingPredictionApiPublisher({
    url: LANDING_PREDICTION_API_URL,
    enabled: LANDING_PREDICTION_API_ENABLED,
    publishIntervalMs: LANDING_PREDICTION_PUBLISH_INTERVAL_MS,
    fetchImpl: global.fetch,
    infoLogger: (message) => console.log(message),
    warnLogger: (message) => console.warn(message)
});
const staticWindProfileProvider = createStaticWindProfileProvider();
const windProfileProvider = createWindProfileProvider();
const landingPredictionService = createLandingPredictionService({
    windProfileProvider
});

function createWindProfileProvider() {
    if (!OPEN_METEO_API_ENABLED) {
        console.warn('Open-Meteo deshabilitado; se usara perfil de viento estatico');
        return staticWindProfileProvider;
    }

    if (typeof global.fetch !== 'function') {
        console.warn('Open-Meteo no disponible; fetch no esta soportado en este entorno. Se usara perfil de viento estatico');
        return staticWindProfileProvider;
    }

    try {
        const openMeteoClient = createOpenMeteoClient({
            apiBaseUrl: OPEN_METEO_API_BASE_URL,
            fetchImpl: global.fetch,
            models: OPEN_METEO_MODELS
        });

        return createOpenMeteoWindProfileProvider({
            client: openMeteoClient,
            coordinateChangeThresholdMeters: OPEN_METEO_COORDINATE_THRESHOLD_METERS,
            fallbackProvider: staticWindProfileProvider,
            infoLogger: (message) => console.log(message),
            refreshIntervalMs: OPEN_METEO_REFRESH_INTERVAL_MS,
            warnLogger: (message) => console.warn(message)
        });
    } catch (error) {
        console.warn(`No se pudo inicializar Open-Meteo: ${error.message}`);
        return staticWindProfileProvider;
    }
}

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
        sendLatestLandingPredictionToWindow(dashboardWindow);
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
        sendLatestLandingPredictionToWindow(mapWindow);
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
        sendLatestLandingPredictionToWindow(model3dWindow);
    });
}

function initGroundGpsWatcher() {
    function readAndApply() {
        try {
            const raw = fs.readFileSync(GROUND_GPS_PATH, 'utf8');
            const coords = JSON.parse(raw);
            if (Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude)
                && (coords.latitude !== 0 || coords.longitude !== 0)) {
                telemetryProcessor.setReceiverLocation({
                    latitude: coords.latitude,
                    longitude: coords.longitude
                });
                handleSystemReceiverLocation({
                    latitude: coords.latitude,
                    longitude: coords.longitude,
                    accuracy: 5,
                    fromFallback: false
                });
            }
        } catch (_) {}
    }

    readAndApply();
    fs.watchFile(GROUND_GPS_PATH, { interval: 1000 }, readAndApply);
}

app.whenReady().then(() => {
    createWindows();
    initGroundGpsWatcher();
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
            if (resolvedInput.type === 'flight-event') {
                handleFlightEvent(resolvedInput);
                return;
            }

            if (resolvedInput.type === 'mission-ack') {
                handleMissionAck(resolvedInput);
                return;
            }

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
        return ports.map((port) => {
            const displayName = resolveSerialPortDisplayName(port);
            const details = formatSerialPortDetails(port);

            return {
                path: port.path,
                manufacturer: port.manufacturer || 'Desconocido',
                displayName,
                details,
                vendorId: port.vendorId,
                productId: port.productId,
                pnpId: port.pnpId,
                serialNumber: port.serialNumber
            };
        });
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

ipcMain.handle('send-command', async (event, command) => {
    if (simulationInterval) {
        if (command === 'MISSION_ON') {
            missionMode = true;
            clearInterval(simulationInterval);
            simulationInterval = setInterval(simulateData, 500);
            console.log('🎯 Modo mision activado (simulacion)');
            broadcastMissionStatus({ active: true, message: 'Mision activa (simulacion)' });
        } else if (command === 'MISSION_OFF') {
            missionMode = false;
            clearInterval(simulationInterval);
            simulationInterval = setInterval(simulateData, 500);
            console.log('⏹ Modo normal restaurado (simulacion)');
            broadcastMissionStatus({ active: false, message: 'Modo normal (3s)' });
        }
        return { success: true };
    }

    if (!serialPort) {
        return { success: false, message: 'No hay puerto serial conectado' };
    }

    if (command === 'MISSION_ON' && !missionCommandSentToFirmware) {
        serialPort.write('MISSION_ON\n', (err) => {
            if (err) {
                console.error('❌ Error al enviar comando:', err.message);
                sendToWindow(dashboardWindow, 'error', 'Error al enviar comando: ' + err.message);
            }
        });
        missionMode = true;
        missionCommandSentToFirmware = true;
        broadcastMissionStatus({ active: true, message: 'Mision iniciada — esperando confirmacion...' });
    } else if (command === 'MISSION_ON' && missionCommandSentToFirmware) {
        missionMode = true;
        broadcastMissionStatus({ active: true, message: 'Mision activa' });
    } else if (command === 'MISSION_OFF') {
        missionMode = false;
        broadcastMissionStatus({ active: false, message: 'Modo normal' });
    }

    return { success: true };
});

function processPayloadData(message) {
    const processedTelemetry = telemetryProcessor.process(message);
    if (!processedTelemetry) {
        return;
    }

    const now = Date.now();
    const channel = processedTelemetry.sourceChannel;

    // Si XBee y ya se emitió LoRa en los últimos TELEMETRY_DEDUP_MS, no emitir duplicado
    if (channel === 'xbee' && (now - lastLoRaEmitTime) < TELEMETRY_DEDUP_MS) {
        logTelemetryDebug('DEDUP', { reason: 'loRa_reciente', channel, lastLoRaEmitTime });
        return;
    }

    if (channel === 'lora') {
        lastLoRaEmitTime = now;
    }

    const recLoc = latestReceiverLocationState;
    if (Number.isFinite(recLoc.latitude) && Number.isFinite(recLoc.longitude)) {
        processedTelemetry.receiverLatitude = recLoc.latitude;
        processedTelemetry.receiverLongitude = recLoc.longitude;
        if (Number.isFinite(processedTelemetry.latitude) && Number.isFinite(processedTelemetry.longitude)) {
            processedTelemetry.distanceToReceiver = calculateDistance(
                recLoc.latitude, recLoc.longitude,
                processedTelemetry.latitude, processedTelemetry.longitude
            );
        }
    }

    latestLandingPrediction = landingPredictionService.update(processedTelemetry);
    latestLandingPredictionDto = toLandingPredictionDto(latestLandingPrediction);

    const payloadData = toTelemetrySampleDto(processedTelemetry);
    logTelemetryDebug('EMITTED', payloadData);

    payloadDataLog.push({ ...payloadData, receivedAt: new Date().toISOString() });
    telemetryPublisher.publish(payloadData);
    broadcastPayloadData([dashboardWindow, mapWindow, model3dWindow], payloadData);
    if (latestLandingPredictionDto) {
        landingPredictionPublisher.publish(latestLandingPredictionDto);
        broadcastLandingPrediction([dashboardWindow, mapWindow, model3dWindow], latestLandingPredictionDto);
    }
}

function handleFlightEvent(resolvedInput) {
    if (!resolvedInput || resolvedInput.event !== 'decoupling-activated') {
        return;
    }

    const statusChanged = telemetryProcessor.setDecouplingStatus(true);
    if (!statusChanged) {
        return;
    }

    console.log('Evento de despliegue detectado: rele activado');
    sendToWindow(dashboardWindow, 'simulation-status', {
        message: 'Rele activado con exito'
    });
}

function handleMissionAck(resolvedInput) {
    if (!resolvedInput || !resolvedInput.ack) return;

    const ack = resolvedInput.ack.trim().toUpperCase();
    if (ack === 'MISSION_ON_ACK') {
        missionMode = true;
        console.log('✅ Modo mision confirmado por estacion terrena');
        broadcastMissionStatus({ active: true, message: 'Mision activa (500ms)' });
    } else if (ack === 'MISSION_OFF_ACK') {
        missionMode = false;
        console.log('✅ Modo normal confirmado por estacion terrena');
        broadcastMissionStatus({ active: false, message: 'Modo normal (3s)' });
    }
}

function broadcastReceiverLocationState(receiverLocationState) {
    latestReceiverLocationState = { ...receiverLocationState };
    [dashboardWindow, mapWindow, model3dWindow].forEach((window) => {
        sendToWindow(window, LOCATION_STATUS_CHANNEL, latestReceiverLocationState);
    });
}

function broadcastMissionStatus(status) {
    [dashboardWindow, mapWindow, model3dWindow].forEach((window) => {
        sendToWindow(window, 'mission-status', status);
    });
}

function sendLatestLandingPredictionToWindow(window) {
    if (!latestLandingPredictionDto) {
        return;
    }

    sendToWindow(window, 'landing-prediction', latestLandingPredictionDto);
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
