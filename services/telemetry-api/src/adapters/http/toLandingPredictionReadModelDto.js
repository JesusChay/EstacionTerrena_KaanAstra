import telemetryContracts from '../../../../../packages/telemetry-contracts/src/index.cjs';

const { createLandingPredictionReadModelDto } = telemetryContracts;

export function toLandingPredictionReadModelDto(record) {
  if (!record) {
    return null;
  }

  return createLandingPredictionReadModelDto(record);
}

export function toLandingPredictionReadModelDtos(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records.map(toLandingPredictionReadModelDto);
}
