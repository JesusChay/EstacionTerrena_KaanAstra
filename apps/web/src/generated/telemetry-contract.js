// Generated from packages/telemetry-contracts. Run `npm run sync:contracts` after changing the shared contract.
export default Object.freeze({
  "telemetrySampleFields": [
    "time",
    "speed",
    "temperature",
    "pressure",
    "accelx",
    "accely",
    "accelz",
    "atotal",
    "gyrox",
    "gyroy",
    "gyroz",
    "gyroxRad",
    "gyroyRad",
    "gyrozRad",
    "magx",
    "magy",
    "magz",
    "altitude",
    "latitude",
    "longitude",
    "sourceChannel",
    "receiverLatitude",
    "receiverLongitude",
    "distanceToReceiver",
    "velocity",
    "velocityZ",
    "relativeAltitude",
    "decouplingStatus"
  ],
  "telemetryReadModelFields": [
    "id",
    "time",
    "speed",
    "temperature",
    "pressure",
    "accelx",
    "accely",
    "accelz",
    "atotal",
    "gyrox",
    "gyroy",
    "gyroz",
    "gyroxRad",
    "gyroyRad",
    "gyrozRad",
    "magx",
    "magy",
    "magz",
    "altitude",
    "latitude",
    "longitude",
    "sourceChannel",
    "receiverLatitude",
    "receiverLongitude",
    "distanceToReceiver",
    "velocity",
    "velocityZ",
    "relativeAltitude",
    "decouplingStatus",
    "receivedAtUtc"
  ],
  "telemetryBooleanFields": [
    "decouplingStatus"
  ],
  "telemetrySampleRequiredFields": [],
  "apiBasePath": "/api",
  "apiPaths": {
    "health": "/health",
    "schema": "/schema",
    "latest": "/latest",
    "recent": "/recent",
    "report": "/report",
    "telemetry": "/telemetry"
  },
  "apiRoutes": {
    "health": "/api/health",
    "schema": "/api/schema",
    "latest": "/api/latest",
    "recent": "/api/recent",
    "report": "/api/report",
    "telemetry": "/api/telemetry"
  },
  "limits": {
    "recent": {
      "default": 24,
      "max": 120
    },
    "report": {
      "default": 5000,
      "max": 10000
    }
  }
});
