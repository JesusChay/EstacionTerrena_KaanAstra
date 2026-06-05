import telemetryContracts from '../../../../../packages/telemetry-contracts/src/index.cjs';

const { TELEMETRY_API_ROUTES, TELEMETRY_LIMITS } = telemetryContracts;

export { TELEMETRY_API_ROUTES, TELEMETRY_LIMITS };

export const telemetrySchemaNotes = Object.freeze([
  'El contrato replica el payloadData actual de la estacion terrena.',
  'El Worker guarda cada muestra en D1 para exponer latest e historial reciente.'
]);

export const telemetryServiceName = 'telemetry-api';
export const telemetryPersistenceName = 'cloudflare-d1';
