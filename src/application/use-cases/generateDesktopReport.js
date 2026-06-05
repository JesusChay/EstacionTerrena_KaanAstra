const { buildDesktopReportArtifacts } = require('./buildDesktopReportArtifacts');

function generateDesktopReport({ samples, reportWriter, isSimulation }) {
    if (!Array.isArray(samples) || samples.length === 0) {
        throw new Error('No hay datos para generar el reporte');
    }

    return reportWriter.write(buildDesktopReportArtifacts({
        samples,
        isSimulation
    }));
}

module.exports = {
    generateDesktopReport
};
