export function createCsvReportArtifact({
  rows,
  generatedAt = new Date(),
  reportFields,
  fieldLabels,
  formatReportValue
}) {
  return {
    fileName: buildReportFileName(generatedAt),
    content: buildCsvContent({
      rows,
      generatedAt,
      reportFields,
      fieldLabels,
      formatReportValue
    })
  };
}

function buildCsvContent({ rows, generatedAt, reportFields, fieldLabels, formatReportValue }) {
  const columns = [
    ['Fecha de descarga', generatedAt.toLocaleString('es-MX', { hour12: false })],
    [],
    reportFields.map((field) => fieldLabels[field] || field)
  ];

  rows.forEach((row) => {
    columns.push(reportFields.map((field) => formatReportValue(field, row[field])));
  });

  return columns
    .map((row) => row.map(escapeCsvValue).join(','))
    .join('\n');
}

function buildReportFileName(date = new Date()) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ];

  return `kaan_astra_reporte_${parts[0]}-${parts[1]}-${parts[2]}_${parts[3]}-${parts[4]}-${parts[5]}.csv`;
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? '');
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }

  return stringValue;
}
