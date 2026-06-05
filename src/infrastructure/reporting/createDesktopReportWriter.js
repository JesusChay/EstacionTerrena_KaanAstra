function createDesktopReportWriter({ fs, path, XLSX, documentsPathProvider }) {
    function write({ generatedAt, excelSheet, analysisText }) {
        const reportsDir = path.join(documentsPathProvider(), 'KAAN_ASTRA_Reportes');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        const headers = excelSheet?.headers || [];
        const rows = excelSheet?.rows || [];
        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        worksheet['!cols'] = headers.map((_, index) => ({
            wch: Math.max(headers[index].length, ...rows.map((row) => (row[index] ? row[index].toString().length : 0))) + 2
        }));

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, excelSheet?.sheetName || 'Reporte CanSat');

        const timestamp = generatedAt.toISOString().replace(/[:.]/g, '-');
        const excelFilePath = path.join(reportsDir, `reporte-cansat-${timestamp}.xlsx`);
        XLSX.writeFile(workbook, excelFilePath);

        const textFilePath = path.join(reportsDir, `reporte-cansat-analisis-${timestamp}.txt`);
        fs.writeFileSync(textFilePath, analysisText || '');

        return {
            excelFilePath,
            textFilePath,
            message: `Reportes generados con exito: ${path.basename(excelFilePath)} y ${path.basename(textFilePath)}`
        };
    }

    return {
        write
    };
}

module.exports = {
    createDesktopReportWriter
};
