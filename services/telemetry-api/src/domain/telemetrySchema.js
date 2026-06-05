import telemetryContracts from '../../../../packages/telemetry-contracts/src/index.cjs';

const {
  TELEMETRY_SAMPLE_FIELDS,
  TELEMETRY_SAMPLE_REQUIRED_FIELDS
} = telemetryContracts;

export const allowedFields = TELEMETRY_SAMPLE_FIELDS;
export const requiredFields = TELEMETRY_SAMPLE_REQUIRED_FIELDS;
