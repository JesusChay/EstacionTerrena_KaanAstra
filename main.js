const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const fs = require('fs');
const XLSX = require('xlsx');
const { parseTelemetryMessage, isTelemetryLine } = require('./telemetry/parser');

let dashboardWindow, mapWindow, model3dWindow;
let serialPort, parser;
let payloadDataLog = [];
let simulationInterval = null;
let simTime = 0;

let payloadSensors = {};

let lastPayloadTime = null;
let lastPayloadUpdateTime = null;
let lastPayloadPosition = null;

const TELEMETRY_API_URL = process.env.TELEMETRY_API_URL || 'https://kaan-astra-telemetry-api.adriancct13.workers.dev/api/telemetry';
const TELEMETRY_API_ENABLED = process.env.TELEMETRY_API_ENABLED !== 'false';
const TELEMETRY_PUBLISH_INTERVAL_MS = Number.parseInt(process.env.TELEMETRY_PUBLISH_INTERVAL_MS || '1000', 10);
let telemetryPublishFailures = 0;
let lastTelemetryPublishAt = 0;

let accelBias = { x: 0, y: 0, z: 0 };
let calibrationSamples = [];
let payloadSources = {
    lora: {},
    xbee: {},
    unknown: {}
};
let serialDebugEnabled = true;
let pendingXbeeTelemetry = {};

const MERGEABLE_TELEMETRY_FIELDS = [
    'speed', 'temperature', 'humidity', 'pressure',
    'accelx', 'accely', 'accelz', 'atotal',
    'gyrox', 'gyroy', 'gyroz', 'gyroxRad', 'gyroyRad', 'gyrozRad',
    'magx', 'magy', 'magz',
    'altitude', 'relativeAltitude',
    'latitude', 'longitude',
    'receiverLatitude', 'receiverLongitude',
    'distanceToReceiver', 'velocity', 'velocityZ',
    'decouplingStatus'
];

class Quaternion {
    constructor(w, x, y, z) {
        this.w = w;
        this.x = x;
        this.y = y;
        this.z = z;
    }

    multiply(q) {
        return new Quaternion(
            this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z,
            this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y,
            this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x,
            this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w
        );
    }

    normalize() {
        const mag = Math.sqrt(this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z);
        if (mag < 1e-6) {
            return new Quaternion(1, 0, 0, 0);
        }
        return new Quaternion(this.w / mag, this.x / mag, this.y / mag, this.z / mag);
    }

    rotateVector(v) {
        if (v.some(isNaN)) {
            return [0, 0, 0];
        }
        const qv = new Quaternion(0, v[0], v[1], v[2]);
        const qConj = new Quaternion(this.w, -this.x, -this.y, -this.z);
        const result = this.multiply(qv).multiply(qConj);
        return [result.x, result.y, result.z];
    }

    update(gyrox, gyroy, gyroz, dt) {
        if (isNaN(gyrox) || isNaN(gyroy) || isNaN(gyroz) || isNaN(dt)) {
            return this;
        }
        const wx = gyrox * Math.PI / 180;
        const wy = gyroy * Math.PI / 180;
        const wz = gyroz * Math.PI / 180;
        const halfDt = dt / 2;
        const qw = 1;
        const qx = wx * halfDt;
        const qy = wy * halfDt;
        const qz = wz * halfDt;
        const deltaQ = new Quaternion(qw, qx, qy, qz).normalize();
        return this.multiply(deltaQ).normalize();
    }

    correctYaw(yawDeg) {
        if (isNaN(yawDeg) || yawDeg < 0 || yawDeg > 360) {
            return this;
        }
        const yawRad = yawDeg * Math.PI / 180;
        const sinYaw = Math.sin(yawRad / 2);
        const cosYaw = Math.cos(yawRad / 2);
        const yawQ = new Quaternion(cosYaw, 0, 0, sinYaw);
        const alpha = 0.1;
        return new Quaternion(
            this.w * (1 - alpha) + yawQ.w * alpha,
            this.x * (1 - alpha),
            this.y * (1 - alpha),
            this.z * (1 - alpha) + yawQ.z * alpha
        ).normalize();
    }

    correctOrientation(accelx, accely, accelz, magy, magz) {
        const mag = Math.sqrt(accelx * accelx + accely * accely + accelz * accelz);
        if (mag < 1e-6) {
            return this;
        }

        const ax = accelx / mag;
        const ay = accely / mag;
        const az = accelz / mag;

        const pitchAccel = Math.asin(-ax);
        const rollAccel = Math.atan2(ay, az);

        let pitch = pitchAccel;
        let roll = rollAccel;
        if (!isNaN(magy) && magy >= -90 && magy <= 90 && !isNaN(magz) && magz >= -90 && magz <= 90) {
            const alphaMag = 0.05;
            pitch = pitchAccel * (1 - alphaMag) + (magy * Math.PI / 180) * alphaMag;
            roll = rollAccel * (1 - alphaMag) + (magz * Math.PI / 180) * alphaMag;
        }

        const cp = Math.cos(pitch / 2);
        const sp = Math.sin(pitch / 2);
        const cr = Math.cos(roll / 2);
        const sr = Math.sin(roll / 2);
        const accelQ = new Quaternion(cp * cr, sp * cr, cp * sr, -sp * sr);

        const alpha = 0.05;
        return new Quaternion(
            this.w * (1 - alpha) + accelQ.w * alpha,
            this.x * (1 - alpha) + accelQ.x * alpha,
            this.y * (1 - alpha) + accelQ.y * alpha,
            this.z * (1 - alpha) + accelQ.z * alpha
        ).normalize();
    }

    static fromAccelAndMag(accelx, accely, accelz, yawDeg) {
        const mag = Math.sqrt(accelx * accelx + accely * accely + accelz * accelz);
        if (mag < 1e-6) {
            return new Quaternion(1, 0, 0, 0);
        }

        const ax = accelx / mag;
        const ay = accely / mag;
        const az = accelz / mag;

        const pitch = Math.asin(-ax);
        const roll = Math.atan2(ay, az);
        const yaw = isNaN(yawDeg) || yawDeg < 0 || yawDeg > 360 ? 0 : yawDeg * Math.PI / 180;

        const cp = Math.cos(pitch / 2);
        const sp = Math.sin(pitch / 2);
        const cr = Math.cos(roll / 2);
        const sr = Math.sin(roll / 2);
        const cy = Math.cos(yaw / 2);
        const sy = Math.sin(yaw / 2);

        return new Quaternion(
            cp * cr * cy + sp * sr * sy,
            sp * cr * cy - cp * sr * sy,
            cp * sr * cy + sp * cr * sy,
            cp * cr * sy - sp * sr * cy
        ).normalize();
    }

    static fromAccel(accelx, accely, accelz) {
        const mag = Math.sqrt(accelx * accelx + accely * accely + accelz * accelz);
        if (mag < 1e-6) {
            return new Quaternion(1, 0, 0, 0);
        }

        const ax = accelx / mag;
        const ay = accely / mag;
        const az = accelz / mag;

        const pitch = Math.asin(-ax);
        const roll = Math.atan2(ay, az);

        const cp = Math.cos(pitch / 2);
        const sp = Math.sin(pitch / 2);
        const cr = Math.cos(roll / 2);
        const sr = Math.sin(roll / 2);

        return new Quaternion(cp * cr, sp * cr, cp * sr, -sp * sr).normalize();
    }
}

class KalmanFilter {
    constructor() {
        this.x = [[0], [0]];
        this.P = [[1000, 0], [0, 1000]];
        this.A = [[1, 0], [0, 1]];
        this.B = [[0], [0]];
        this.H = [[1, 0]];
        this.Q = [[0.001, 0], [0, 0.001]];
        this.R = [[1]];
    }

    multiplyMatrix(A, B) {
        if (!A[0] || !B[0] || A[0].length !== B.length) {
            console.error('Error de multiplicación de matrices: Dimensiones incompatibles');
            console.error('A dimensiones:', A.length, A[0] ? A[0].length : 0);
            console.error('B dimensiones:', B.length, B[0] ? B[0].length : 0);
            console.error('A:', A);
            console.error('B:', B);
            return [[0]];
        }
        const rowsA = A.length, colsA = A[0].length, colsB = B[0].length;
        const result = Array(rowsA).fill().map(() => Array(colsB).fill(0));
        for (let i = 0; i < rowsA; i++) {
            for (let j = 0; j < colsB; j++) {
                for (let k = 0; k < colsA; k++) {
                    result[i][j] += A[i][k] * B[k][j];
                }
            }
        }
        return result;
    }

    transpose(A) {
        return A[0].map((_, colIndex) => A.map(row => row[colIndex]));
    }

    inverseMatrix1x1(A) {
        if (Math.abs(A[0][0]) < 1e-6) {
            return [[1]];
        }
        return [[1 / A[0][0]]];
    }

    predict(u, dt) {
        if (isNaN(u) || dt <= 0 || isNaN(dt) || dt > 1) {
            return;
        }
        this.A = [[1, dt], [0, 1]];
        this.B = [[dt * dt / 2], [dt]];

        const Ax = this.multiplyMatrix(this.A, this.x);
        const Bu = this.multiplyMatrix(this.B, [[u]]);
        this.x = [[Ax[0][0] + Bu[0][0]], [Ax[1][0] + Bu[1][0]]];

        const P_A = this.multiplyMatrix(this.P, this.transpose(this.A));
        this.P = this.multiplyMatrix(this.A, P_A);
        for (let i = 0; i < 2; i++) {
            for (let j = 0; j < 2; j++) {
                this.P[i][j] += this.Q[i][j];
            }
        }
    }

    update(z) {
        if (isNaN(z) || z < 0 || z > 2000) {
            return;
        }

        const Ht = this.transpose(this.H);
        const H_P = this.multiplyMatrix(this.H, this.P);
        const H_P_Ht = this.multiplyMatrix(H_P, Ht);
        const H_P_Ht_R = [[H_P_Ht[0][0] + this.R[0][0]]];
        const K_num = this.multiplyMatrix(this.P, Ht);
        const K_den = this.inverseMatrix1x1(H_P_Ht_R);
        const K = this.multiplyMatrix(K_num, K_den);

        const Hx = this.multiplyMatrix(this.H, this.x);
        const innovation = z - Hx[0][0];
        this.x[0][0] += K[0][0] * innovation;
        this.x[1][0] += K[1][0] * innovation;

        const KH = this.multiplyMatrix(K, this.H);
        const I_KH = [[1 - KH[0][0], -KH[0][1]], [-KH[1][0], 1 - KH[1][1]]];
        this.P = this.multiplyMatrix(I_KH, this.P);
    }

    getState() {
        return {
            relativeAltitude: Math.max(0, this.x[0][0]),
            velocityZ: this.x[1][0]
        };
    }

    reset() {
        this.x = [[0], [0]];
        this.P = [[1000, 0], [0, 1000]];
    }
}

let payloadKalman = null;
let payloadOrientation = new Quaternion(1, 0, 0, 0);

function calibrateAccelerometer(accelx, accely, accelz) {
    const samples = calibrationSamples;
    const bias = accelBias;
    const maxSamples = 100;

    const accelTotal = Math.sqrt(accelx * accelx + accely * accely + accelz * accelz);
    if (Math.abs(accelTotal - 1) < 0.2) {
        samples.push({ x: accelx, y: accely, z: accelz });
    }

    if (samples.length >= maxSamples) {
        bias.x = samples.reduce((sum, s) => sum + s.x, 0) / samples.length;
        bias.y = samples.reduce((sum, s) => sum + s.y, 0) / samples.length;
        bias.z = samples.reduce((sum, s) => sum + s.z, 0) / samples.length - 1;
        console.log('Acelerometro calibrado:', bias);
        samples.length = 0;
    }
}

async function publishTelemetry(payloadData) {
    if (!TELEMETRY_API_ENABLED || !payloadData) {
        return;
    }

    const now = Date.now();
    if (Number.isFinite(TELEMETRY_PUBLISH_INTERVAL_MS) && TELEMETRY_PUBLISH_INTERVAL_MS > 0 && now - lastTelemetryPublishAt < TELEMETRY_PUBLISH_INTERVAL_MS) {
        return;
    }

    lastTelemetryPublishAt = now;

    try {
        const response = await fetch(TELEMETRY_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ telemetry: payloadData })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        if (telemetryPublishFailures > 0) {
            console.log('Conexion con la API de telemetria restablecida');
        }
        telemetryPublishFailures = 0;
    } catch (error) {
        telemetryPublishFailures += 1;
        if (telemetryPublishFailures === 1 || telemetryPublishFailures % 10 === 0) {
            console.warn(`No se pudo publicar telemetria en ${TELEMETRY_API_URL}: ${error.message}`);
        }
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

function stripEspLogPrefix(line) {
    return line
        .replace(/\x1b\[[0-9;]*m/gi, '')
        .replace(/\[[0-9;]+m/gi, '')
        .replace(/^[IWE]\s*\(\d+\)\s+[^:]+:\s*/, '')
        .trim();
}

function parseXbeeReceiverLog(line) {
    const text = stripEspLogPrefix(line);
    let match;

    if (/^Paquete\s+#/i.test(text)) {
        pendingXbeeTelemetry = { sourceChannel: 'xbee' };
        return null;
    }

    match = text.match(/^Presion:\s*(-?\d+(?:\.\d+)?)\s*hPa/i);
    if (match) {
        pendingXbeeTelemetry.pressure = Number.parseFloat(match[1]);
        return null;
    }

    match = text.match(/^Temperatura:\s*(-?\d+(?:\.\d+)?)\s*(?:C|grad\/C)/i);
    if (match) {
        pendingXbeeTelemetry.temperature = Number.parseFloat(match[1]);
        return null;
    }

    match = text.match(/^Acelerometro:\s*X=(-?\d+(?:\.\d+)?)\s*Y=(-?\d+(?:\.\d+)?)\s*Z=(-?\d+(?:\.\d+)?)/i);
    if (match) {
        pendingXbeeTelemetry.accelx = Number.parseFloat(match[1]);
        pendingXbeeTelemetry.accely = Number.parseFloat(match[2]);
        pendingXbeeTelemetry.accelz = Number.parseFloat(match[3]);
        return null;
    }

    match = text.match(/^Giroscopio:\s*X=(-?\d+(?:\.\d+)?)\s*Y=(-?\d+(?:\.\d+)?)\s*Z=(-?\d+(?:\.\d+)?)/i);
    if (match) {
        pendingXbeeTelemetry.gyrox = Number.parseFloat(match[1]);
        pendingXbeeTelemetry.gyroy = Number.parseFloat(match[2]);
        pendingXbeeTelemetry.gyroz = Number.parseFloat(match[3]);
        return null;
    }

    match = text.match(/^Magnetometro:\s*X=(-?\d+(?:\.\d+)?)\s*Y=(-?\d+(?:\.\d+)?)\s*Z=(-?\d+(?:\.\d+)?)/i);
    if (match) {
        pendingXbeeTelemetry.magx = Number.parseFloat(match[1]);
        pendingXbeeTelemetry.magy = Number.parseFloat(match[2]);
        pendingXbeeTelemetry.magz = Number.parseFloat(match[3]);
        return null;
    }

    match = text.match(/^Altitud:\s*(-?\d+(?:\.\d+)?)\s*m/i);
    if (match) {
        pendingXbeeTelemetry.altitude = Number.parseFloat(match[1]);
        return null;
    }

    match = text.match(/^GPS TX:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    if (match) {
        pendingXbeeTelemetry.latitude = Number.parseFloat(match[1]);
        pendingXbeeTelemetry.longitude = Number.parseFloat(match[2]);
        return null;
    }

    match = text.match(/^DISTANCIA:\s*(-?\d+(?:\.\d+)?)\s*metros/i);
    if (match) {
        pendingXbeeTelemetry.distanceToReceiver = Number.parseFloat(match[1]);
        return null;
    }

    if (/^GPS Local:\s*sin senal/i.test(text)) {
        return { ...pendingXbeeTelemetry };
    }

    if (/^=+$/i.test(text)) {
        if (Object.keys(pendingXbeeTelemetry).length > 1) {
            return { ...pendingXbeeTelemetry };
        }
    }

    return null;
}

function formatTaggedTelemetryMessage(source, telemetry) {
    const fieldMap = {
        pressure: 'PRES',
        temperature: 'TEMP',
        humidity: 'HUM',
        speed: 'SPEED',
        accelx: 'ACCX',
        accely: 'ACCY',
        accelz: 'ACCZ',
        gyrox: 'GYROX',
        gyroy: 'GYROY',
        gyroz: 'GYROZ',
        magx: 'MAGX',
        magy: 'MAGY',
        magz: 'MAGZ',
        altitude: 'ALT',
        latitude: 'LAT',
        longitude: 'LON',
        receiverLatitude: 'RXLAT',
        receiverLongitude: 'RXLON',
        distanceToReceiver: 'DIST',
        decouplingStatus: 'DECOUP'
    };

    const parts = Object.entries(fieldMap)
        .filter(([key]) => telemetry[key] !== undefined)
        .map(([key, tag]) => `${tag}:${telemetry[key]}`);

    return `[${source}] ${parts.join(',')}`;
}

function createWindows() {
    dashboardWindow = new BrowserWindow({
        width: 1200,
        height: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    dashboardWindow.loadFile('dashboard.html');

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
            preload: path.join(__dirname, 'preload.js')
        }
    });
    mapWindow.loadFile('map.html');

    model3dWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    model3dWindow.loadFile('model3d.html');
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

function generateRandom(min, max) {
    return (Math.random() * (max - min) + min).toFixed(2);
}

function simulateData() {
    simTime += 0.5;
    let altitude, accelx, accely, accelz, gyrox, gyroy, gyroz, magx, magy, magz, speed;
    let latitude = 19.6;
    let longitude = -99.1;

    if (simTime < 10) {
        altitude = 100 * simTime;
        accelz = 1.5;
        speed = 3.6 * 100 / 10;
        latitude += simTime * 0.0001;
        longitude += simTime * 0.0001;
    } else if (simTime < 12) {
        altitude = 1000;
        accelz = 1.0;
        speed = 0;
        latitude += 10 * 0.0001;
        longitude += 10 * 0.0001;
    } else if (simTime <= 30) {
        altitude = 1000 - 50 * (simTime - 12);
        accelz = 1.0;
        speed = 3.6 * 50;
        latitude += (10 + (simTime - 12) * 0.00005);
        longitude += (10 + (simTime - 12) * 0.00005);
    } else {
        altitude = 0;
        accelz = 1.0;
        speed = 0;
        latitude += 10 * 0.0001;
        longitude += 10 * 0.0001;
    }

    accelx = parseFloat(generateRandom(-0.1, 0.1));
    accely = parseFloat(generateRandom(-0.1, 0.1));
    gyrox = parseFloat(generateRandom(-10, 10));
    gyroy = parseFloat(generateRandom(-10, 10));
    gyroz = parseFloat(generateRandom(-10, 10));
    magx = parseFloat(generateRandom(0, 360));
    magy = parseFloat(generateRandom(-10, 10));
    magz = parseFloat(generateRandom(-10, 10));

    const payloadData = [
        speed,
        generateRandom(15, 35),
        generateRandom(20, 80),
        generateRandom(95000, 105000),
        accelx, accely, accelz,
        gyrox, gyroy, gyroz,
        magx, magy, magz,
        altitude,
        latitude, longitude,
        simTime > 10 ? 'true' : 'false'
    ].join(',');

    processPayloadData(payloadData);
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
            const trimmed = line.trim();
            if (!trimmed) return;

            logSerialDebug('RX', trimmed);

            const cleaned = stripEspLogPrefix(trimmed);
            if (cleaned !== trimmed) {
                logSerialDebug('CLEAN', cleaned);
            }

            const reconstructedXbee = parseXbeeReceiverLog(trimmed);
            if (reconstructedXbee) {
                logTelemetryDebug('RECONSTRUCTED_XBEE', reconstructedXbee);
                processPayloadData(formatTaggedTelemetryMessage('XBEE', reconstructedXbee));
                return;
            }

            if (!isTelemetryLine(cleaned)) {
                logSerialDebug('IGNORED', cleaned);
                return;
            }

            if (cleaned.startsWith('[PAYLOAD]')) {
                processPayloadData(cleaned.replace('[PAYLOAD]', '').trim());
            } else if (cleaned.startsWith('[PRIMARY]')) {
                // Legacy firmware format (pre-refactor)
                processPayloadData(cleaned.replace('[PRIMARY]', '').trim());
            } else if (cleaned.startsWith('[SECONDARY]')) {
                // Legacy firmware format (pre-refactor)
                processPayloadData(cleaned.replace('[SECONDARY]', '').trim());
            } else {
                // Tagged telemetry or raw CSV without tags
                processPayloadData(cleaned);
            }
        });

        serialPort.on('error', (err) => {
            console.error('❌ Error en el puerto serial:', err.message);
            if (dashboardWindow && !dashboardWindow.isDestroyed()) {
                dashboardWindow.webContents.send('error', 'Error en el puerto serial: ' + err.message);
            }
        });

        serialPort.on('close', () => {
            console.warn('⚠️ Puerto serial cerrado');
            if (dashboardWindow && !dashboardWindow.isDestroyed()) {
                dashboardWindow.webContents.send('error', 'Puerto serial cerrado. Verifica la conexion del receptor.');
            }
        });

        serialPort.on('open', () => {
            console.log('✅ Puerto serial abierto:', portName);
            if (dashboardWindow && !dashboardWindow.isDestroyed()) {
                dashboardWindow.webContents.send('simulation-status', { message: `Conectado al puerto ${portName}` });
            }
        });
    } catch (err) {
        console.error('❌ Error al inicializar el puerto:', err.message);
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
            dashboardWindow.webContents.send('error', 'No se pudo inicializar el puerto serial: ' + portName);
        }
    }
}

ipcMain.handle('list-serial-ports', async () => {
    try {
        const ports = await SerialPort.list();
        return ports.map(port => ({ path: port.path, manufacturer: port.manufacturer || 'Desconocido' }));
    } catch (err) {
        console.error('❌ Error al listar puertos:', err.message);
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
            dashboardWindow.webContents.send('error', 'No se pudieron listar los puertos seriales.');
        }
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
        dashboardWindow.webContents.send('error', `No se pudo establecer el puerto ${portName}.`);
        return { success: false, message: `Error al establecer el puerto ${portName}.` };
    }
});

function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
    const toRad = x => x * Math.PI / 180;
    const R = 6371e3;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toNumber(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
}

function normalizePressureToHpa(pressure) {
    if (!Number.isFinite(pressure)) return undefined;
    // Heuristic: if value looks like Pa (e.g. 95000..105000), convert to hPa.
    return pressure > 2000 ? pressure / 100 : pressure;
}

function normalizeRawSensorUnits(parsed) {
    const normalized = { ...parsed };

    const accelKeys = ['accelx', 'accely', 'accelz'];
    const accelValues = accelKeys.map((key) => normalized[key]).filter(Number.isFinite);
    if (accelValues.length > 0 && accelValues.some((value) => Math.abs(value) > 4)) {
        accelKeys.forEach((key) => {
            if (Number.isFinite(normalized[key])) {
                normalized[key] = normalized[key] / 16384.0;
            }
        });
    }

    const gyroKeys = ['gyrox', 'gyroy', 'gyroz'];
    const gyroValues = gyroKeys.map((key) => normalized[key]).filter(Number.isFinite);
    if (gyroValues.length > 0 && gyroValues.some((value) => Math.abs(value) > 250)) {
        gyroKeys.forEach((key) => {
            if (Number.isFinite(normalized[key])) {
                normalized[key] = normalized[key] / 131.0;
            }
        });
    }

    return normalized;
}

function isTelemetryValueUsable(key, value) {
    if (value === undefined || value === null) return false;
    if (typeof value === 'boolean') return true;
    if (!Number.isFinite(value)) return false;

    if (key === 'latitude' || key === 'longitude' || key === 'receiverLatitude' || key === 'receiverLongitude') {
        return value !== 0;
    }

    return value !== 0;
}

function getChannelState(sourceChannel) {
    if (sourceChannel === 'lora' || sourceChannel === 'xbee') {
        return payloadSources[sourceChannel];
    }
    return payloadSources.unknown;
}

function mergeTelemetrySources(preferredSource) {
    const preferred = getChannelState(preferredSource);
    const alternate = preferredSource === 'lora' ? payloadSources.xbee : preferredSource === 'xbee' ? payloadSources.lora : {};
    const merged = {};

    for (const key of MERGEABLE_TELEMETRY_FIELDS) {
        const preferredValue = preferred[key];
        const alternateValue = alternate[key];

        if (isTelemetryValueUsable(key, preferredValue)) {
            merged[key] = preferredValue;
        } else if (isTelemetryValueUsable(key, alternateValue)) {
            merged[key] = alternateValue;
        } else if (preferredValue !== undefined) {
            merged[key] = preferredValue;
        } else if (alternateValue !== undefined) {
            merged[key] = alternateValue;
        }
    }

    merged.sourceChannel = preferredSource || preferred.sourceChannel || alternate.sourceChannel || payloadSensors.sourceChannel;
    return merged;
}

function processPayloadData(message) {
    const rawParsed = parseTelemetryMessage(message);
    if (!rawParsed) {
        console.warn(`⚠️ No se pudo interpretar la linea serial: ${message}`);
        return;
    }

    logTelemetryDebug('PARSED_RAW', rawParsed);
    const parsed = normalizeRawSensorUnits(rawParsed);
    logTelemetryDebug('PARSED_NORMALIZED', parsed);

    const sourceChannel = parsed.sourceChannel || 'unknown';

    const ACCEL_MAX = 4;
    if (parsed.accelx !== undefined || parsed.accely !== undefined || parsed.accelz !== undefined) {
        const ax = parsed.accelx;
        const ay = parsed.accely;
        const az = parsed.accelz;
        if (ax === undefined || ay === undefined || az === undefined) {
            console.warn('⚠️ Se recibio aceleracion incompleta; se ignora la muestra', parsed);
            return;
        }
        if (Math.abs(ax) > ACCEL_MAX || Math.abs(ay) > ACCEL_MAX || Math.abs(az) > ACCEL_MAX) {
            console.warn(`❌ Payload: Aceleracion fuera de rango: (${ax}, ${ay}, ${az})`);
            return;
        }
    }

    const sourceState = getChannelState(sourceChannel);
    for (const [k, v] of Object.entries(parsed)) {
        if (v !== undefined) {
            sourceState[k] = v;
        }
    }
    sourceState.sourceChannel = sourceChannel;

    payloadSensors = {
        ...payloadSensors,
        ...mergeTelemetrySources(sourceChannel)
    };

    const currentTime = new Date();
    const timeString = currentTime.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour12: false });

    const speed = payloadSensors.speed;
    const temperature = payloadSensors.temperature;
    const humidity = payloadSensors.humidity;
    const pressure = payloadSensors.pressure;
    const accelx = payloadSensors.accelx;
    const accely = payloadSensors.accely;
    const accelz = payloadSensors.accelz;
    const gyrox = payloadSensors.gyrox;
    const gyroy = payloadSensors.gyroy;
    const gyroz = payloadSensors.gyroz;
    const magx = payloadSensors.magx;
    const magy = payloadSensors.magy;
    const magz = payloadSensors.magz;
    const altitude = payloadSensors.altitude;
    const latitude = payloadSensors.latitude;
    const longitude = payloadSensors.longitude;
    const receiverLatitude = payloadSensors.receiverLatitude;
    const receiverLongitude = payloadSensors.receiverLongitude;
    const decouplingStatus = payloadSensors.decouplingStatus === true;
    const activeSourceChannel = payloadSensors.sourceChannel;

    let correctedAccelx;
    let correctedAccely;
    let correctedAccelz;
    if (Number.isFinite(accelx) && Number.isFinite(accely) && Number.isFinite(accelz)) {
        calibrateAccelerometer(accelx, accely, accelz);
        correctedAccelx = accelx - accelBias.x;
        correctedAccely = accely - accelBias.y;
        correctedAccelz = accelz - accelBias.z;
    }

    let velocity = 0;
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        if (lastPayloadPosition) {
            const dist = calculateDistance(
                lastPayloadPosition.latitude,
                lastPayloadPosition.longitude,
                latitude,
                longitude
            );
            const deltaTime = lastPayloadTime ? Math.min((currentTime - lastPayloadTime) / 1000, 1) : 0.5;
            velocity = deltaTime > 0 ? dist / deltaTime : 0;
        }
        lastPayloadPosition = { latitude, longitude };
    }

    let distanceToReceiver = payloadSensors.distanceToReceiver;
    if (!Number.isFinite(distanceToReceiver) && Number.isFinite(latitude) && Number.isFinite(longitude) && Number.isFinite(receiverLatitude) && Number.isFinite(receiverLongitude)) {
        distanceToReceiver = calculateDistance(receiverLatitude, receiverLongitude, latitude, longitude);
    }

    const GRAVITY = 9.81;
    let relativeAltitude;
    let velocityZ;
    if (Number.isFinite(altitude) && Number.isFinite(correctedAccelx) && Number.isFinite(correctedAccely) && Number.isFinite(correctedAccelz)) {
        if (!payloadKalman) {
            payloadKalman = new KalmanFilter();
            payloadOrientation = Number.isFinite(magx)
                ? Quaternion.fromAccelAndMag(correctedAccelx, correctedAccely, correctedAccelz, magx)
                : Quaternion.fromAccel(correctedAccelx, correctedAccely, correctedAccelz);
        }

        const deltaTime = lastPayloadTime ? Math.min((currentTime - lastPayloadTime) / 1000, 0.5) : 0.1;
        if (deltaTime > 0 && deltaTime <= 0.5) {
            payloadOrientation = payloadOrientation.update(
                Number.isFinite(gyrox) ? gyrox : 0,
                Number.isFinite(gyroy) ? gyroy : 0,
                Number.isFinite(gyroz) ? gyroz : 0,
                deltaTime
            );

            if (Number.isFinite(magx)) {
                payloadOrientation = payloadOrientation.correctYaw(magx);
            }
            payloadOrientation = payloadOrientation.correctOrientation(correctedAccelx, correctedAccely, correctedAccelz, magy, magz);

            const accelVector = [correctedAccelx * GRAVITY, correctedAccely * GRAVITY, correctedAccelz * GRAVITY];
            const rotatedAccel = payloadOrientation.rotateVector(accelVector);
            let accelZNet = rotatedAccel[2] - GRAVITY;

            const ACCELZNET_THRESHOLD = 0.02;
            if (Math.abs(accelZNet) < ACCELZNET_THRESHOLD) {
                accelZNet = 0;
            }

            payloadKalman.predict(accelZNet, deltaTime);
            const ALTITUDE_MAX = 2000;
            if (altitude >= 0 && altitude <= ALTITUDE_MAX) {
                payloadKalman.update(altitude);
            }

            const state = payloadKalman.getState();
            relativeAltitude = state.relativeAltitude;
            velocityZ = state.velocityZ;

            const accelTotal = Math.sqrt(correctedAccelx * correctedAccelx + correctedAccely * correctedAccely + correctedAccelz * correctedAccelz);
            const gyroTotal = Math.sqrt((gyrox || 0) * (gyrox || 0) + (gyroy || 0) * (gyroy || 0) + (gyroz || 0) * (gyroz || 0));
            if (Math.abs(accelTotal - 1) < 0.15 && Math.abs(velocityZ) < 0.1 && Math.abs(altitude) < 10 && gyroTotal < 5) {
                relativeAltitude = 0;
                velocityZ = 0;
                payloadKalman.reset();
                payloadOrientation = Number.isFinite(magx)
                    ? Quaternion.fromAccelAndMag(correctedAccelx, correctedAccely, correctedAccelz, magx)
                    : Quaternion.fromAccel(correctedAccelx, correctedAccely, correctedAccelz);
            }

            lastPayloadUpdateTime = currentTime;
        }
    }

    if (lastPayloadUpdateTime && (currentTime - lastPayloadUpdateTime) / 1000 > 10) {
        if (payloadKalman) payloadKalman.reset();
        if (Number.isFinite(correctedAccelx) && Number.isFinite(correctedAccely) && Number.isFinite(correctedAccelz)) {
            payloadOrientation = Number.isFinite(magx)
                ? Quaternion.fromAccelAndMag(correctedAccelx, correctedAccely, correctedAccelz, magx)
                : Quaternion.fromAccel(correctedAccelx, correctedAccely, correctedAccelz);
        }
        console.warn('Filtro de Kalman y orientacion reiniciados por falta de datos validos');
    }

    lastPayloadTime = currentTime;

    const format = (v, digits) => (Number.isFinite(v) ? v.toFixed(digits) : undefined);

    const atotal = (Number.isFinite(correctedAccelx) && Number.isFinite(correctedAccely) && Number.isFinite(correctedAccelz))
        ? Math.sqrt(correctedAccelx * correctedAccelx + correctedAccely * correctedAccely + correctedAccelz * correctedAccelz)
        : undefined;

    const payloadData = {
        time: timeString,
        speed: Number.isFinite(speed) ? (speed / 3.6).toFixed(2) : undefined,
        temperature: format(temperature, 2),
        humidity: format(humidity, 2),
        pressure: format(pressure, 2),
        accelx: format(correctedAccelx, 2),
        accely: format(correctedAccely, 2),
        accelz: format(correctedAccelz, 2),
        atotal: format(atotal, 2),
        gyrox: format(gyrox, 2),
        gyroy: format(gyroy, 2),
        gyroz: format(gyroz, 2),
        gyroxRad: Number.isFinite(gyrox) ? (gyrox * 0.0174533).toFixed(4) : undefined,
        gyroyRad: Number.isFinite(gyroy) ? (gyroy * 0.0174533).toFixed(4) : undefined,
        gyrozRad: Number.isFinite(gyroz) ? (gyroz * 0.0174533).toFixed(4) : undefined,
        magx: format(magx, 2),
        magy: format(magy, 2),
        magz: format(magz, 2),
        altitude: format(altitude, 2),
        latitude: Number.isFinite(latitude) ? latitude.toFixed(6) : undefined,
        longitude: Number.isFinite(longitude) ? longitude.toFixed(6) : undefined,
        receiverLatitude: Number.isFinite(receiverLatitude) ? receiverLatitude.toFixed(6) : undefined,
        receiverLongitude: Number.isFinite(receiverLongitude) ? receiverLongitude.toFixed(6) : undefined,
        distanceToReceiver: format(distanceToReceiver, 2),
        velocity: format(velocity, 2),
        velocityZ: format(velocityZ, 2),
        relativeAltitude: format(relativeAltitude, 2),
        decouplingStatus,
        sourceChannel: activeSourceChannel
    };

    logTelemetryDebug('MERGED_STATE', payloadSensors);
    logTelemetryDebug('EMITTED', payloadData);

    payloadDataLog.push(payloadData);
    publishTelemetry(payloadData);
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('payload-data', payloadData);
    }
    if (mapWindow && !mapWindow.isDestroyed()) {
        mapWindow.webContents.send('payload-data', payloadData);
    }
    if (model3dWindow && !model3dWindow.isDestroyed()) {
        model3dWindow.webContents.send('payload-data', payloadData);
    }
}

ipcMain.on('generate-report', () => {
    if (payloadDataLog.length === 0) {
        console.log('No hay datos para generar el reporte');
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
            dashboardWindow.webContents.send('error', 'No hay datos para generar el reporte');
        }
        return;
    }

    const reportsDir = path.join(app.getPath('documents'), 'KAAN_ASTRA_Reportes');
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
    }

    const headers = [
        'Tiempo',
        'Velocidad del viento (m/s)',
        'Temperatura (°C)',
        'Humedad (%)',
        'Presion (hPa)',
        'Aceleracion X (g)',
        'Aceleracion Y (g)',
        'Aceleracion Z (g)',
        'Aceleracion Total (g)',
        'Giroscopio X (°/s)',
        'Giroscopio Y (°/s)',
        'Giroscopio Z (°/s)',
        'Magnetometro Yaw (°)',
        'Magnetometro Pitch (°)',
        'Magnetometro Roll (°)',
        'Altitud (m)',
        'Altitud Alternativa (m)',
        'Latitud',
        'Longitud',
        'Velocidad de Desplazamiento (m/s)',
        'Velocidad Vertical (m/s)',
        'Desacople'
    ];

    const data = payloadDataLog.map(d => ([
        d.time || '',
        d.speed || '',
        d.temperature || '',
        d.humidity || '',
        d.pressure || '',
        d.accelx || '',
        d.accely || '',
        d.accelz || '',
        d.atotal || '',
        d.gyrox || '',
        d.gyroy || '',
        d.gyroz || '',
        d.magx || '',
        d.magy || '',
        d.magz || '',
        d.altitude || '',
        d.relativeAltitude || '',
        d.latitude || '',
        d.longitude || '',
        d.velocity || '',
        d.velocityZ || '',
        d.decouplingStatus ? 'true' : 'false'
    ]));

    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = headers.map((_, index) => ({ wch: Math.max(headers[index].length, ...data.map(row => (row[index] ? row[index].toString().length : 0))) + 2 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reporte CanSat');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const excelFilePath = path.join(reportsDir, `reporte-cansat-${timestamp}.xlsx`);
    XLSX.writeFile(wb, excelFilePath);
    console.log(`Archivo Excel guardado en: ${excelFilePath}`);

    const textFilePath = path.join(reportsDir, `reporte-cansat-analisis-${timestamp}.txt`);
    const duration = payloadDataLog.length * 0.5;
    const samples = payloadDataLog.length;

    const calculateStats = (dataArr, key) => {
        const values = dataArr.map(d => parseFloat(d[key])).filter(v => !isNaN(v));
        return {
            avg: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0,
            min: values.length > 0 ? Math.min(...values) : 0,
            max: values.length > 0 ? Math.max(...values) : 0
        };
    };

    const stats = {
        speed: calculateStats(payloadDataLog, 'speed'),
        temperature: calculateStats(payloadDataLog, 'temperature'),
        humidity: calculateStats(payloadDataLog, 'humidity'),
        pressure: calculateStats(payloadDataLog, 'pressure'),
        accelx: calculateStats(payloadDataLog, 'accelx'),
        accely: calculateStats(payloadDataLog, 'accely'),
        accelz: calculateStats(payloadDataLog, 'accelz'),
        atotal: calculateStats(payloadDataLog, 'atotal'),
        gyrox: calculateStats(payloadDataLog, 'gyrox'),
        gyroy: calculateStats(payloadDataLog, 'gyroy'),
        gyroz: calculateStats(payloadDataLog, 'gyroz'),
        magx: calculateStats(payloadDataLog, 'magx'),
        magy: calculateStats(payloadDataLog, 'magy'),
        magz: calculateStats(payloadDataLog, 'magz'),
        altitude: calculateStats(payloadDataLog, 'altitude'),
        relativeAltitude: calculateStats(payloadDataLog, 'relativeAltitude'),
        velocity: calculateStats(payloadDataLog, 'velocity'),
        velocityZ: calculateStats(payloadDataLog, 'velocityZ')
    };

    let txtContent = 'Reporte de Analisis CanSat\n';
    txtContent += `Generado el: ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}\n`;
    txtContent += `Modo: ${simulationInterval ? 'Simulacion' : 'Datos Reales'}\n\n`;

    txtContent += 'Resumen General:\n';
    txtContent += `- Duracion total estimada: ${duration.toFixed(2)} segundos\n`;
    txtContent += `- Numero de muestras: ${samples}\n\n`;

    txtContent += 'Estadisticas de Magnitudes:\n\n';
    txtContent += '1. Velocidad del Viento (m/s):\n';
    txtContent += `   - Promedio: ${stats.speed.avg.toFixed(2)}\n`;
    txtContent += `   - Minimo: ${stats.speed.min.toFixed(2)}\n`;
    txtContent += `   - Maximo: ${stats.speed.max.toFixed(2)}\n\n`;

    txtContent += '2. Temperatura (°C):\n';
    txtContent += `   - Promedio: ${stats.temperature.avg.toFixed(2)}\n`;
    txtContent += `   - Minimo: ${stats.temperature.min.toFixed(2)}\n`;
    txtContent += `   - Maximo: ${stats.temperature.max.toFixed(2)}\n\n`;

    txtContent += '3. Humedad (%):\n';
    txtContent += `   - Promedio: ${stats.humidity.avg.toFixed(2)}\n`;
    txtContent += `   - Minimo: ${stats.humidity.min.toFixed(2)}\n`;
    txtContent += `   - Maximo: ${stats.humidity.max.toFixed(2)}\n\n`;

    txtContent += '4. Presion (hPa):\n';
    txtContent += `   - Promedio: ${stats.pressure.avg.toFixed(2)}\n`;
    txtContent += `   - Minimo: ${stats.pressure.min.toFixed(2)}\n`;
    txtContent += `   - Maximo: ${stats.pressure.max.toFixed(2)}\n\n`;

    txtContent += '5. Aceleracion Total (g):\n';
    txtContent += `   - Promedio: ${stats.atotal.avg.toFixed(2)}\n`;
    txtContent += `   - Minimo: ${stats.atotal.min.toFixed(2)}\n`;
    txtContent += `   - Maximo: ${stats.atotal.max.toFixed(2)}\n\n`;

    txtContent += '6. Altitud (m):\n';
    txtContent += `   - Promedio: ${stats.altitude.avg.toFixed(2)}\n`;
    txtContent += `   - Minimo: ${stats.altitude.min.toFixed(2)}\n`;
    txtContent += `   - Maximo: ${stats.altitude.max.toFixed(2)}\n\n`;

    txtContent += '7. Altitud Alternativa (m):\n';
    txtContent += `   - Promedio: ${stats.relativeAltitude.avg.toFixed(2)}\n`;
    txtContent += `   - Minimo: ${stats.relativeAltitude.min.toFixed(2)}\n`;
    txtContent += `   - Maximo: ${stats.relativeAltitude.max.toFixed(2)}\n\n`;

    txtContent += '8. Velocidad de Desplazamiento (m/s):\n';
    txtContent += `   - Promedio: ${stats.velocity.avg.toFixed(2)}\n`;
    txtContent += `   - Minimo: ${stats.velocity.min.toFixed(2)}\n`;
    txtContent += `   - Maximo: ${stats.velocity.max.toFixed(2)}\n\n`;

    txtContent += '9. Velocidad Vertical (m/s):\n';
    txtContent += `   - Promedio: ${stats.velocityZ.avg.toFixed(2)}\n`;
    txtContent += `   - Minimo: ${stats.velocityZ.min.toFixed(2)}\n`;
    txtContent += `   - Maximo: ${stats.velocityZ.max.toFixed(2)}\n`;

    fs.writeFileSync(textFilePath, txtContent);
    console.log(`Archivo de texto guardado en: ${textFilePath}`);

    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('report-generated', {
            message: `Reportes generados con exito: ${path.basename(excelFilePath)} y ${path.basename(textFilePath)}`
        });
    }
});
