import telemetryContracts from '@kaan-astra/telemetry-contracts';

const { createTelemetryReadModelDto } = telemetryContracts;

export function toTelemetryReadModelDto(record) {
  if (!record) {
    return null;
  }

  return createTelemetryReadModelDto(record);
}

export function toTelemetryReadModelDtos(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records.map(toTelemetryReadModelDto);
}
