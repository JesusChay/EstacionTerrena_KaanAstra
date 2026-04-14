const test = require('node:test');
const assert = require('node:assert/strict');

const {
    isTelemetryLine,
    parseTaggedTelemetry,
    parsePayloadCsv,
    parseTelemetryMessage
} = require('./parser');

test('detecta linea LORA etiquetada', () => {
    assert.equal(isTelemetryLine('[LORA] LAT:20.967370,LON:-89.623710'), true);
});

test('detecta linea XBEE con TX', () => {
    assert.equal(isTelemetryLine('TX:20.967370,-89.623710 | RX:20.1,-89.1 | D=10.0m'), true);
});

test('ignora log no telemetrico', () => {
    assert.equal(isTelemetryLine('Inicializando RYLR998 LoRa...'), false);
});

test('parsea mensaje etiquetado de LORA con lat y lon', () => {
    assert.deepEqual(
        parseTaggedTelemetry('[LORA] LAT:20.967370,LON:-89.623710'),
        {
            sourceChannel: 'lora',
            latitude: 20.96737,
            longitude: -89.62371
        }
    );
});

test('parsea mensaje etiquetado de XBEE con mas magnitudes', () => {
    assert.deepEqual(
        parseTaggedTelemetry('[XBEE] LAT:20.967365,LON:-89.623705,TEMP:24.5,HUM:60.1,ALT:129.5,DECOUP:true'),
        {
            sourceChannel: 'xbee',
            latitude: 20.967365,
            longitude: -89.623705,
            temperature: 24.5,
            humidity: 60.1,
            altitude: 129.5,
            decouplingStatus: true
        }
    );
});

test('parsea salida de receptor con TX y RX', () => {
    assert.deepEqual(
        parseTaggedTelemetry('TX:20.967370,-89.623710 | RX:20.967300,-89.623600 | D=10.20m'),
        {
            latitude: 20.96737,
            longitude: -89.62371
        }
    );
});

test('parsea csv completo de payload legado/actual', () => {
    const parsed = parsePayloadCsv('4.80,25.40,60.10,1008.70,0.11,-0.02,1.01,0.12,0.09,0.03,140.10,-8.10,30.00,129.50,20.967370,-89.623710,false');
    assert.equal(parsed.temperature, 25.4);
    assert.equal(parsed.longitude, -89.62371);
    assert.equal(parsed.decouplingStatus, false);
});

test('parseTelemetryMessage prioriza formato etiquetado', () => {
    const parsed = parseTelemetryMessage('[LORA] LAT:20.967370,LON:-89.623710');
    assert.equal(parsed.sourceChannel, 'lora');
    assert.equal(parsed.latitude, 20.96737);
});
