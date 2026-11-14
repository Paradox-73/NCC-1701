// The ONE file that holds domain content: which sources stream, which channel groups exist, what each channel
// measures, who may see what, and which readings raise alerts. Everything else (wire format, server, simulator,
// load test, dashboard) reads it. To change the domain, replace this file and keep the export names.
//
// PLACEHOLDER: a small starship set until the final registry from docs/DOMAIN.md lands.

/** A source is one telemetry producer (a connection to /ingest). `hz` is the rate it samples every channel at. */
export const SOURCES = [
  { id: 1, name: 'USS Enterprise', code: 'NCC-1701', hz: 10 },
  { id: 2, name: 'USS Reliant', code: 'NCC-1864', hz: 10 },
  { id: 3, name: 'USS Excelsior', code: 'NCC-2000', hz: 10 },
];

/** Groups double as Socket.IO room suffixes: a client watching `src:1:warp` never receives other groups. */
export const GROUP_DEFS = [
  { key: 'warp', label: 'Warp core' },
  { key: 'shields', label: 'Shields' },
  { key: 'lifesupport', label: 'Life support' },
  { key: 'navigation', label: 'Navigation' },
  { key: 'crew', label: 'Crew biosigns' },
];

/**
 * Channel order is the order of values in a packed sample. A value travels as an integer: real value * scale, rounded.
 * min and max are in real units and bound what the server accepts. `nominal` is the calm running value; the simulator
 * and the tests start from it.
 */
export const CHANNELS = [
  { key: 'warpFactor', label: 'Warp factor', unit: '', min: 0, max: 9.99, scale: 100, nominal: 6, group: 'warp' },
  { key: 'plasmaTemp', label: 'Plasma temperature', unit: 'MK', min: 0, max: 100, scale: 10, nominal: 45, group: 'warp' },
  { key: 'antimatterFlow', label: 'Antimatter flow', unit: 'mg/s', min: 0, max: 500, scale: 10, nominal: 220, group: 'warp' },
  { key: 'corePower', label: 'Core power', unit: '%', min: 0, max: 130, scale: 10, nominal: 85, group: 'warp' },
  { key: 'shieldFore', label: 'Shield fore', unit: '%', min: 0, max: 100, scale: 10, nominal: 92, group: 'shields' },
  { key: 'shieldAft', label: 'Shield aft', unit: '%', min: 0, max: 100, scale: 10, nominal: 92, group: 'shields' },
  { key: 'shieldPort', label: 'Shield port', unit: '%', min: 0, max: 100, scale: 10, nominal: 92, group: 'shields' },
  { key: 'shieldStbd', label: 'Shield starboard', unit: '%', min: 0, max: 100, scale: 10, nominal: 92, group: 'shields' },
  { key: 'o2Level', label: 'Oxygen', unit: '%', min: 0, max: 30, scale: 100, nominal: 21, group: 'lifesupport' },
  { key: 'co2Level', label: 'Carbon dioxide', unit: 'ppm', min: 0, max: 5000, scale: 1, nominal: 600, group: 'lifesupport' },
  { key: 'cabinTemp', label: 'Cabin temperature', unit: '°C', min: 0, max: 50, scale: 10, nominal: 22, group: 'lifesupport' },
  { key: 'cabinPressure', label: 'Cabin pressure', unit: 'kPa', min: 0, max: 150, scale: 10, nominal: 101, group: 'lifesupport' },
  { key: 'posX', label: 'Position X', unit: 'Mkm', min: -1e6, max: 1e6, scale: 1, nominal: 120000, group: 'navigation' },
  { key: 'posY', label: 'Position Y', unit: 'Mkm', min: -1e6, max: 1e6, scale: 1, nominal: -45000, group: 'navigation' },
  { key: 'posZ', label: 'Position Z', unit: 'Mkm', min: -1e6, max: 1e6, scale: 1, nominal: 8000, group: 'navigation' },
  { key: 'speed', label: 'Speed', unit: 'km/s', min: 0, max: 300000, scale: 1, nominal: 120000, group: 'navigation' },
  { key: 'heading', label: 'Heading', unit: '°', min: 0, max: 360, scale: 10, nominal: 90, group: 'navigation' },
  { key: 'crewAboard', label: 'Crew aboard', unit: '', min: 0, max: 1000, scale: 1, nominal: 430, group: 'crew' },
  { key: 'heartRate', label: 'Mean heart rate', unit: 'bpm', min: 0, max: 250, scale: 1, nominal: 72, group: 'crew' },
  { key: 'stressIndex', label: 'Stress index', unit: '%', min: 0, max: 100, scale: 10, nominal: 20, group: 'crew' },
];

/**
 * Roles. `groups` are the channel groups the role may subscribe to and see alerts for. `canAck` allows acknowledging
 * alerts of those groups. `admin` allows metrics and the simulator command channel.
 */
export const ROLES = {
  captain: { label: 'Captain', groups: GROUP_DEFS.map((g) => g.key), canAck: true, admin: false },
  chief_engineer: { label: 'Chief Engineer', groups: ['warp', 'shields'], canAck: true, admin: false },
  chief_medical_officer: { label: 'Chief Medical Officer', groups: ['lifesupport', 'crew'], canAck: true, admin: false },
  science_officer: { label: 'Science Officer', groups: ['navigation', 'shields', 'lifesupport'], canAck: true, admin: false },
  communications_officer: { label: 'Communications Officer', groups: ['navigation'], canAck: false, admin: false },
  starfleet_command: { label: 'Starfleet Command', groups: GROUP_DEFS.map((g) => g.key), canAck: true, admin: true },
};

/**
 * Alert rules on single channels. `dir` is 'high' (alert above the limit) or 'low' (below it); `warn` is the first
 * limit and `critical` the second, beyond it. `zChannels` are also watched by the rolling z-score detector.
 */
const shield = (key) => ({ type: 'shield-low', channel: key, dir: 'low', warn: 30, critical: 10 });
export const RULES = {
  thresholds: [
    { type: 'core-temp', channel: 'plasmaTemp', dir: 'high', warn: 70, critical: 85 },
    { type: 'core-power', channel: 'corePower', dir: 'high', warn: 105, critical: 115 },
    shield('shieldFore'), shield('shieldAft'), shield('shieldPort'), shield('shieldStbd'),
    { type: 'oxygen-low', channel: 'o2Level', dir: 'low', warn: 19, critical: 17 },
    { type: 'co2-high', channel: 'co2Level', dir: 'high', warn: 1500, critical: 3000 },
  ],
  zChannels: ['plasmaTemp', 'antimatterFlow', 'corePower', 'cabinTemp', 'cabinPressure', 'heartRate', 'stressIndex'],
};
