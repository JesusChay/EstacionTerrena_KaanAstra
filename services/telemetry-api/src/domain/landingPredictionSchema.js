import telemetryContracts from '../../../../packages/telemetry-contracts/src/index.cjs';

const {
  LANDING_PREDICTION_REQUIRED_FIELDS,
  LANDING_PREDICTION_SAMPLE_FIELDS
} = telemetryContracts;

export const allowedLandingPredictionFields = LANDING_PREDICTION_SAMPLE_FIELDS;
export const requiredLandingPredictionFields = LANDING_PREDICTION_REQUIRED_FIELDS;
