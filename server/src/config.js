import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

// Secrets that ship in this repository (defaults, .env.example, docker-compose.yml): anyone can read them.
const PUBLIC_SECRETS = new Set(['dev-only-secret-change-me', 'dev-device-key', 'change-me', 'change-me-too', 'change-me-in-real-deployments']);

/** With NODE_ENV=production, throws on a public secret: with it anyone could sign a command token or pose as a source. */
export function checkSecrets(config, env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  for (const [name, value] of [['JWT_SECRET', config.jwtSecret], ['DEVICE_KEY', config.deviceKey]]) {
    if (PUBLIC_SECRETS.has(value)) throw new Error(`${name} is unset or a public example value; set a private one (NODE_ENV=production)`);
  }
}

/** Reads settings from the environment; `overrides` wins (used by tests). */
export function loadConfig(overrides = {}) {
  const env = process.env;
  return {
    port: num(env.PORT, 4000),
    // 127.0.0.1, not localhost: localhost can resolve to ::1 first, where another process may listen
    mongoUri: env.MONGO_URI || 'mongodb://127.0.0.1:27017/ncc1701',
    jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
    deviceKey: env.DEVICE_KEY || 'dev-device-key',
    corsOrigin: (env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()),
    logLevel: env.LOG_LEVEL || 'info',
    trustProxy: env.TRUST_PROXY === '1',
    simEmbed: env.SIM_EMBED === '1', // index.js starts the simulator next to the server
    // writer
    flushMs: 250,
    flushSamples: 2000,
    highWater: num(env.WRITER_HIGH_WATER, 20000),
    // storage: raw telemetry and alerts expire on their own (MongoDB TTL), so a small Atlas cluster does not fill up
    telemetryTtlSec: num(env.TELEMETRY_TTL_SEC, 24 * 3600),
    telemetryTimeseries: env.TELEMETRY_TIMESERIES !== '0', // 0 makes a new telemetry collection plain, as on a refusal
    crewStoreEvery: num(env.CREW_STORE_EVERY, 1), // 5 on a hosted tier: the crew hub streams every second but stores one sample in 5
    alertsTtlSec: num(env.ALERTS_TTL_SEC, 7 * 24 * 3600),
    // streaming
    frameMs: num(env.FRAME_MS, 50),
    overviewMs: 200,
    metricsMs: 1000,
    inflightCredit: 4,
    // rate limits per IP per minute
    apiRateLimit: num(env.API_RATE_LIMIT, 600),
    loginRateLimit: num(env.LOGIN_RATE_LIMIT, 10),
    // anomaly detection
    linkLossMs: 1500,
    debounceMs: 3000,
    ...overrides,
  };
}
