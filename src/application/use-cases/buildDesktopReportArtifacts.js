function buildDesktopReportArtifacts({ samples, isSimulation, generatedAt = new Date() }) {
    const since = new Date(generatedAt.getTime() - 2 * 60 * 60 * 1000);
    const recentSamples = samples.filter(function (s) {
        var ts = s.receivedAt ? new Date(s.receivedAt) : null;
        return ts && ts >= since;
    });

    if (recentSamples.length === 0) {
        throw new Error('No hay datos de las ultimas 2 horas para generar el reporte');
    }

    const headers = [
        'Tiempo',
        'Temperatura (°C)',
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

    const rows = recentSamples.map((sample) => ([
        sample.time ?? '',
        sample.temperature ?? '',
        sample.pressure ?? '',
        sample.accelx ?? '',
        sample.accely ?? '',
        sample.accelz ?? '',
        sample.atotal ?? '',
        sample.gyrox ?? '',
        sample.gyroy ?? '',
        sample.gyroz ?? '',
        sample.magx ?? '',
        sample.magy ?? '',
        sample.magz ?? '',
        sample.altitude ?? '',
        sample.relativeAltitude ?? '',
        sample.latitude ?? '',
        sample.longitude ?? '',
        sample.velocity ?? '',
        sample.velocityZ ?? '',
        sample.decouplingStatus ? 'true' : 'false'
    ]));

    return {
        generatedAt,
        excelSheet: {
            sheetName: 'Reporte CanSat',
            headers,
            rows
        },
        analysisText: buildAnalysisReport({
            samples: recentSamples,
            generatedAt,
            isSimulation
        })
    };
}

function buildAnalysisReport({ samples, generatedAt, isSimulation }) {
    const duration = samples.length * 0.5;
    const stats = {
        temperature: calculateStats(samples, 'temperature'),
        pressure: calculateStats(samples, 'pressure'),
        atotal: calculateStats(samples, 'atotal'),
        altitude: calculateStats(samples, 'altitude'),
        relativeAltitude: calculateStats(samples, 'relativeAltitude'),
        velocity: calculateStats(samples, 'velocity'),
        velocityZ: calculateStats(samples, 'velocityZ')
    };

    let text = 'Reporte de Analisis CanSat\n';
    text += `Generado el: ${generatedAt.toLocaleString('en-GB', { timeZone: 'Europe/London' })}\n`;
    text += `Modo: ${isSimulation ? 'Simulacion' : 'Datos Reales'}\n\n`;
    text += 'Resumen General:\n';
    text += `- Duracion total estimada: ${duration.toFixed(2)} segundos\n`;
    text += `- Numero de muestras: ${samples.length}\n\n`;
    text += 'Estadisticas de Magnitudes:\n\n';
    text += buildStatBlock('1. Temperatura (°C)', stats.temperature);
    text += buildStatBlock('2. Presion (hPa)', stats.pressure);
    text += buildStatBlock('3. Aceleracion Total (g)', stats.atotal);
    text += buildStatBlock('4. Altitud (m)', stats.altitude);
    text += buildStatBlock('5. Altitud Alternativa (m)', stats.relativeAltitude);
    text += buildStatBlock('6. Velocidad de Desplazamiento (m/s)', stats.velocity);
    text += buildStatBlock('7. Velocidad Vertical (m/s)', stats.velocityZ, false);
    return text;
}

function buildStatBlock(title, stats, withTrailingGap = true) {
    let block = `${title}:\n`;
    block += `   - Promedio: ${stats.avg.toFixed(2)}\n`;
    block += `   - Minimo: ${stats.min.toFixed(2)}\n`;
    block += `   - Maximo: ${stats.max.toFixed(2)}\n`;
    if (withTrailingGap) {
        block += '\n';
    }
    return block;
}

function calculateStats(samples, key) {
    const values = samples
        .map((sample) => parseFloat(sample[key]))
        .filter((value) => !Number.isNaN(value));

    return {
        avg: values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
        min: values.length > 0 ? Math.min(...values) : 0,
        max: values.length > 0 ? Math.max(...values) : 0
    };
}

module.exports = {
    buildDesktopReportArtifacts
};
