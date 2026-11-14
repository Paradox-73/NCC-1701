// The ONE file that holds domain content: which sources stream, which channel groups exist, what each channel
// measures, who may see what, and which readings raise alerts. Everything else (wire format, server, simulator,
// load test, dashboard) reads it. The content follows docs/DOMAIN.md: the USS Enterprise (NCC-1701), three sister
// ships and one sickbay biomonitor hub per ship, from the original 1966-69 series.

/**
 * A source is one telemetry producer (one connection to /ingest). `kind` picks its channel list in KINDS, `hz` is
 * the rate it samples every channel at on a laptop and `hostedHz` the rate on a free hosted tier. A crew hub belongs
 * to the ship named by `ship`.
 */
export const SOURCES = [
  { id: 1, kind: 'ship', name: 'USS Enterprise', code: 'NCC-1701', hz: 50, hostedHz: 20 },
  { id: 2, kind: 'ship', name: 'USS Constellation', code: 'NCC-1017', hz: 20, hostedHz: 5 },
  { id: 3, kind: 'ship', name: 'USS Exeter', code: 'NCC-1672', hz: 20, hostedHz: 5 },
  { id: 4, kind: 'ship', name: 'USS Intrepid', code: 'NCC-1631', hz: 20, hostedHz: 5 },
  { id: 11, kind: 'crew', ship: 1, name: 'Enterprise sickbay', code: 'NCC-1701', hz: 1, hostedHz: 1 },
  { id: 12, kind: 'crew', ship: 2, name: 'Constellation sickbay', code: 'NCC-1017', hz: 1, hostedHz: 0 },
  { id: 13, kind: 'crew', ship: 3, name: 'Exeter sickbay', code: 'NCC-1672', hz: 1, hostedHz: 0 },
  { id: 14, kind: 'crew', ship: 4, name: 'Intrepid sickbay', code: 'NCC-1631', hz: 1, hostedHz: 0 },
];

export const CREW_SIZE = 430;
export const DECKS = 12;
export const pad = (n, w = 2) => String(n).padStart(w, '0');
/** Crew 1-12 are on deck 1, then 38 per deck down to deck 12. */
export const deckOfCrew = (n) => (n <= 12 ? 1 : 2 + Math.floor((n - 13) / 38));
const DEPTS = ['Command', 'Operations', 'Engineering', 'Science', 'Medical', 'Security', 'Communications', 'Helm'];
/** Department of crew member n: a fixed spread, so the same person is always in the same one. */
export const deptOfCrew = (n) => DEPTS[(n * 7 + 3) % DEPTS.length];
/** "Crew 207 · Operations · Deck 7"; no names, so nothing personal leaves Sickbay. */
export const crewLabel = (n) => `Crew ${pad(n, 3)} · ${deptOfCrew(n)} · Deck ${deckOfCrew(n)}`;

export const DECK_NAMES = ['Bridge', 'Officers quarters', 'Crew quarters', 'Laboratories', 'Sickbay', 'Recreation', 'Transporter rooms', 'Shuttle hangar', 'Cargo and food stores', 'Life support and hydroponics', 'Main engineering', 'Impulse and auxiliary control'];

/** Groups double as Socket.IO room suffixes: a client watching `src:1:warp` never receives other groups. */
const SHIP_GROUPS = [
  { key: 'helm', label: 'Helm' },
  { key: 'warp', label: 'Warp core' },
  { key: 'impulse', label: 'Impulse engines' },
  { key: 'shields', label: 'Shields' },
  { key: 'weapons', label: 'Phasers and torpedoes' },
  { key: 'power', label: 'Power' },
  { key: 'hull', label: 'Hull' },
  { key: 'lifesupport', label: 'Life support' },
  { key: 'gravity', label: 'Artificial gravity' },
  { key: 'sensors', label: 'Sensors' },
  { key: 'transporter', label: 'Transporter' },
  { key: 'comms', label: 'Communications' },
  { key: 'crewsummary', label: 'Crew summary' },
].map((g) => ({ ...g, kind: 'ship' }));
const CREW_GROUPS = Array.from({ length: DECKS }, (_, i) => ({ key: `bio-d${pad(i + 1)}`, label: `Biosigns, deck ${i + 1}`, kind: 'crew' }));
export const GROUP_DEFS = [...SHIP_GROUPS, ...CREW_GROUPS];

// [key, label, unit, min, max, scale, nominal, group] in packed-sample order. A value travels as an integer: real
// value * scale, rounded. min and max bound what the server accepts; nominal is the calm running value.
const SHIP_ROWS = [
  ['warpFactor', 'Warp factor', '', 0, 9.99, 100, 6, 'helm'],
  ['impulse', 'Impulse power', '%', 0, 100, 10, 0, 'helm'],
  ['speed', 'Speed', 'c', 0, 1000, 10, 216, 'helm'],
  ['heading', 'Heading', '°', 0, 360, 10, 90, 'helm'],
  ['posX', 'Position X', 'su', -5000, 5000, 10, 0, 'helm'],
  ['posY', 'Position Y', 'su', -5000, 5000, 10, 0, 'helm'],
  ['orbitAlt', 'Orbit altitude', 'km', 0, 2000, 1, 0, 'helm'],
  ['descentRate', 'Descent rate', 'm/s', -500, 2000, 1, 0, 'helm'],
  ['reactionRate', 'Matter/antimatter reaction rate', '% of rated', 0, 130, 10, 64, 'warp'],
  ['intermixDev', 'Intermix deviation from 1:1', '%', 0, 50, 100, 0.8, 'warp'],
  ['dilithiumEff', 'Dilithium crystal efficiency', '%', 0, 100, 10, 98, 'warp'],
  ['dilithiumTemp', 'Crystal chamber temperature', '°C', 0, 2000, 1, 690, 'warp'],
  ['chamberTemp', 'Reaction chamber temperature', 'MK', 0, 100, 10, 44, 'warp'],
  ['nacellePort', 'Port nacelle output', '%', 0, 130, 10, 63, 'warp'],
  ['nacelleStbd', 'Starboard nacelle output', '%', 0, 130, 10, 63, 'warp'],
  ['nacelleDelta', 'Nacelle imbalance', '%', 0, 100, 10, 1, 'warp'],
  ['warpField', 'Warp field stability', '%', 0, 100, 10, 99, 'warp'],
  ['impulseReactor', 'Impulse reactor output', '%', 0, 130, 10, 0, 'impulse'],
  ['impulseTemp', 'Impulse reactor temperature', '°C', 0, 2000, 1, 300, 'impulse'],
  ['shieldsUp', 'Shields raised', '', 0, 1, 1, 0, 'shields'],
  ['shieldFore', 'Shield strength, fore', '%', 0, 100, 10, 99.5, 'shields'],
  ['shieldAft', 'Shield strength, aft', '%', 0, 100, 10, 99.5, 'shields'],
  ['shieldPort', 'Shield strength, port', '%', 0, 100, 10, 99.5, 'shields'],
  ['shieldStbd', 'Shield strength, starboard', '%', 0, 100, 10, 99.5, 'shields'],
  ['shieldLoad', 'Shield generator load', '%', 0, 150, 10, 10, 'shields'],
  ['phaserFore', 'Fore phaser bank charge', '%', 0, 100, 10, 100, 'weapons'],
  ['phaserAft', 'Aft phaser bank charge', '%', 0, 100, 10, 100, 'weapons'],
  ['phaserTemp', 'Phaser coolant temperature', '°C', 0, 200, 10, 30, 'weapons'],
  ['torpedoes', 'Photon torpedoes left', '', 0, 50, 1, 24, 'weapons'],
  ['tubesLoaded', 'Torpedo tubes loaded', '', 0, 2, 1, 2, 'weapons'],
  ['powerTotal', 'Total power output', '% of rated', 0, 130, 10, 82, 'power'],
  ['allocWarp', 'Power to warp', '%', 0, 100, 10, 55, 'power'],
  ['allocShields', 'Power to shields', '%', 0, 100, 10, 15, 'power'],
  ['allocWeapons', 'Power to weapons', '%', 0, 100, 10, 10, 'power'],
  ['allocLife', 'Power to life support', '%', 0, 100, 10, 20, 'power'],
  ['battery', 'Emergency battery charge', '%', 0, 100, 10, 100, 'power'],
  ['hullIntegrity', 'Hull integrity', '%', 0, 100, 10, 100, 'hull'],
  ['hullTemp', 'Hull temperature', '°C', -150, 2000, 1, -10, 'hull'],
  ['hullStress', 'Structural stress', '% of limit', 0, 150, 10, 10, 'hull'],
];
const SHIP_TAIL = [
  ['lrSensor', 'Long-range sensor health', '%', 0, 100, 10, 98.5, 'sensors'],
  ['srSensor', 'Short-range sensor health', '%', 0, 100, 10, 98.5, 'sensors'],
  ['contacts', 'Contacts tracked', '', 0, 50, 1, 0, 'sensors'],
  ['contactBearing', 'Nearest contact bearing', '°', 0, 360, 10, 0, 'sensors'],
  ['contactRange', 'Nearest contact range', 'km', 0, 1_000_000, 1, 1_000_000, 'sensors'],
  ['contactSnr', 'Nearest contact signal strength', 'dB', 0, 60, 10, 2, 'sensors'],
  ['ionFlux', 'Ion flux', 'index', 0, 100, 10, 4, 'sensors'],
  ['lifeforms', 'Unregistered life-forms aboard', '', 0, 2_000_000, 1, 0, 'sensors'],
  ['xpState', 'Transporter state (0 idle, 1 energizing, 2 transporting, 3 fault)', '', 0, 3, 1, 0, 'transporter'],
  ['xpEnergy', 'Transporter energy', 'MW', 0, 60, 10, 0, 'transporter'],
  ['xpLock', 'Signal lock', '%', 0, 100, 10, 100, 'transporter'],
  ['xpPattern', 'Pattern integrity', '%', 0, 100, 100, 100, 'transporter'],
  ['carrier', 'Subspace carrier strength', 'dB', 0, 80, 10, 45, 'comms'],
  ['delay', 'Signal delay to Starfleet Command', 's', 0, 600, 10, 1.2, 'comms'],
  ['loss', 'Message loss', '%', 0, 100, 10, 0.3, 'comms'],
  ['interference', 'Interference', '%', 0, 100, 10, 3, 'comms'],
  ['channelsOpen', 'Open channels', '', 0, 16, 1, 2, 'comms'],
  ['hailing', 'Hailing frequencies open', '', 0, 1, 1, 0, 'comms'],
  ['crewAboard', 'Crew aboard', '', 0, 1000, 1, CREW_SIZE, 'crewsummary'],
  ['crewWatch', 'Crew on medical watch', '', 0, 1000, 1, 0, 'crewsummary'],
  ['crewCritical', 'Crew in critical condition', '', 0, 1000, 1, 0, 'crewsummary'],
  ['crewMeanHr', 'Mean crew heart rate', 'bpm', 0, 250, 10, 72, 'crewsummary'],
];
// Per deck NN = 01..12. Deck 1 is the bridge; the other deck names are our choice (DECK_NAMES).
const DECK_ROWS = (n) => {
  const d = pad(n);
  return [
    [`o2_${d}`, `Oxygen, deck ${n}`, '%', 0, 30, 100, 20.9, 'lifesupport'],
    [`co2_${d}`, `Carbon dioxide, deck ${n}`, 'ppm', 0, 20000, 1, 600, 'lifesupport'],
    [`temp_${d}`, `Temperature, deck ${n}`, '°C', -50, 80, 10, 21.5, 'lifesupport'],
    [`press_${d}`, `Pressure, deck ${n}`, 'kPa', 0, 150, 10, 101.3, 'lifesupport'],
  ];
};
const GRAV_ROWS = (n) => [[`grav_${pad(n)}`, `Artificial gravity, deck ${n}`, 'g', 0, 3, 1000, 1, 'gravity']];
const decks = Array.from({ length: DECKS }, (_, i) => i + 1);
const toChannel = ([key, label, unit, min, max, scale, nominal, group]) => ({ key, label, unit, min, max, scale, nominal, group });
// Order: everything up to hull, then life support (48), gravity (12), then the rest, so each group is contiguous.
const SHIP_CHANNELS = [...SHIP_ROWS, ...decks.flatMap(DECK_ROWS), ...decks.flatMap(GRAV_ROWS), ...SHIP_TAIL].map(toChannel);

const VITALS = [
  { v: 'hr', label: 'Heart rate', unit: 'bpm', min: 0, max: 250, scale: 1, nominal: 70 },
  { v: 'rr', label: 'Respiration', unit: '/min', min: 0, max: 80, scale: 1, nominal: 15 },
  { v: 'bt', label: 'Body temperature', unit: '°C', min: 25, max: 45, scale: 10, nominal: 36.8 },
  { v: 'nr', label: 'Neural activity', unit: '%', min: 0, max: 300, scale: 1, nominal: 100 },
];
export const VITAL_KEYS = VITALS.map((x) => x.v);
const CREW_CHANNELS = [];
for (let n = 1; n <= CREW_SIZE; n++)
  for (const x of VITALS)
    CREW_CHANNELS.push({ key: `${x.v}_${pad(n, 3)}`, label: `${x.label}, crew ${pad(n, 3)}`, unit: x.unit, min: x.min, max: x.max, scale: x.scale, nominal: x.nominal, group: `bio-d${pad(deckOfCrew(n))}` });

/**
 * What a source of each kind streams. `storeEvery`: one stored sample in N (the crew hub can store less than it
 * streams on a hosted tier); live frames always carry every sample.
 */
export const KINDS = {
  ship: { channels: SHIP_CHANNELS, groups: SHIP_GROUPS.map((g) => g.key), storeEvery: 1 },
  crew: { channels: CREW_CHANNELS, groups: CREW_GROUPS.map((g) => g.key), storeEvery: 1 },
};
/** Every channel of every kind. Keys never repeat across kinds, so a flat list and map work. */
export const CHANNELS = [...SHIP_CHANNELS, ...CREW_CHANNELS];

const ALL_SHIP_GROUPS = KINDS.ship.groups;
const ALL_CREW_GROUPS = KINDS.crew.groups;
const COMMAND_FAMILIES = ['helm.*', 'tactical.*', 'ship.*', 'comms.*', 'engineering.*', 'transporter.*', 'medical.*', 'science.*', 'security.*', 'scenario.*'];

/**
 * Roles. `groups` are the channel groups the role may subscribe to and see alerts for; `ships` the source ids it may
 * see; `commands` the command types it may send (`family.*` matches every command of a family); `canAck` allows
 * acknowledging alerts of its groups; `admin` allows metrics and the simulator command channel.
 */
export const ROLES = {
  captain: { label: 'Captain', ships: [1, 11], groups: [...ALL_SHIP_GROUPS, ...ALL_CREW_GROUPS], commands: COMMAND_FAMILIES, canAck: true, admin: false },
  chief_engineer: {
    label: 'Chief Engineer', ships: [1],
    groups: ['warp', 'impulse', 'power', 'shields', 'weapons', 'hull', 'lifesupport', 'gravity', 'transporter', 'crewsummary'],
    commands: ['engineering.*', 'transporter.energize'], canAck: true, admin: false,
  },
  chief_medical_officer: {
    label: 'Chief Medical Officer', ships: [1, 11], groups: ['crewsummary', 'lifesupport', 'gravity', ...ALL_CREW_GROUPS],
    commands: ['medical.*'], canAck: true, admin: false,
  },
  science_officer: {
    label: 'Science Officer', ships: [1], groups: ['sensors', 'helm', 'shields', 'hull', 'transporter', 'comms', 'crewsummary'],
    commands: ['science.scan'], canAck: true, admin: false,
  },
  communications_officer: { label: 'Communications Officer', ships: [1], groups: ['comms', 'helm', 'sensors', 'crewsummary'], commands: ['comms.*'], canAck: true, admin: false },
  starfleet_command: { label: 'Starfleet Command', ships: [1, 2, 3, 4], groups: [...ALL_SHIP_GROUPS], commands: ['scenario.*', 'sim.fault'], canAck: true, admin: true },
};

/** True when a role's `commands` list allows the command type. */
export const roleMayCommand = (role, type) => !!ROLES[role]?.commands.some((p) => (p.endsWith('.*') ? type.startsWith(p.slice(0, -1)) : p === type));

/** Ship groups whose critical alert raises a ship at normal condition to yellow. */
export const ESCALATING_GROUPS = ['hull', 'shields', 'lifesupport', 'warp', 'crewsummary'];

// ---- alert rules -------------------------------------------------------------------------------------------------
// `dir` 'high' alerts above a limit, 'low' below it; `warn` is the first limit (YELLOW), `critical` the second (RED).
// Two-sided limits are two rules on one channel with different `type` names. All limits are our choice.
const T = (type, channel, dir, warn, critical) => ({ type, channel, dir, warn, critical });
const deckRules = decks.flatMap((n) => {
  const d = pad(n);
  return [
    T('oxygen-low', `o2_${d}`, 'low', 19.5, 17), T('co2-high', `co2_${d}`, 'high', 2000, 5000),
    T('deck-hot', `temp_${d}`, 'high', 30, 40), T('deck-cold', `temp_${d}`, 'low', 12, 5),
    T('pressure-low', `press_${d}`, 'low', 90, 75),
    T('gravity-low', `grav_${d}`, 'low', 0.8, 0.5), T('gravity-high', `grav_${d}`, 'high', 1.2, 1.5),
  ];
});
const crewRules = Array.from({ length: CREW_SIZE }, (_, i) => pad(i + 1, 3)).flatMap((n) => [
  T('hr-high', `hr_${n}`, 'high', 120, 150), T('hr-low', `hr_${n}`, 'low', 45, 35),
  T('rr-high', `rr_${n}`, 'high', 28, 35),
  T('fever', `bt_${n}`, 'high', 38.5, 40), T('hypothermia', `bt_${n}`, 'low', 35.5, 34),
  T('neural-high', `nr_${n}`, 'high', 140, 170), T('neural-low', `nr_${n}`, 'low', 60, 40),
]);
const shipRules = [
  T('warp-overspeed', 'warpFactor', 'high', 8.5, 9.2), T('descent-rate', 'descentRate', 'high', 50, 200),
  T('reaction-rate', 'reactionRate', 'high', 95, 105), T('intermix-dev', 'intermixDev', 'high', 5, 10),
  T('dilithium-eff', 'dilithiumEff', 'low', 80, 60), T('dilithium-temp', 'dilithiumTemp', 'high', 900, 1100),
  T('chamber-temp', 'chamberTemp', 'high', 70, 85), T('nacelle-imbalance', 'nacelleDelta', 'high', 5, 12),
  T('warp-field', 'warpField', 'low', 90, 80),
  T('impulse-overload', 'impulseReactor', 'high', 100, 115), T('impulse-temp', 'impulseTemp', 'high', 800, 1000),
  ...['Fore', 'Aft', 'Port', 'Stbd'].map((q) => T('shield-low', `shield${q}`, 'low', 50, 25)),
  T('shield-load', 'shieldLoad', 'high', 85, 100),
  T('phaser-temp', 'phaserTemp', 'high', 80, 110),
  T('power-overload', 'powerTotal', 'high', 105, 115), T('battery-low', 'battery', 'low', 50, 20),
  T('hull-integrity', 'hullIntegrity', 'low', 75, 50), T('hull-heat', 'hullTemp', 'high', 400, 900), T('hull-stress', 'hullStress', 'high', 70, 90),
  ...deckRules,
  T('lr-sensor', 'lrSensor', 'low', 70, 40), T('sr-sensor', 'srSensor', 'low', 70, 40),
  T('contact-close', 'contactRange', 'low', 50_000, 10_000), T('ion-flux', 'ionFlux', 'high', 40, 70), T('lifeforms', 'lifeforms', 'high', 100, 10_000),
  T('transporter-fault', 'xpState', 'high', 2.5, 2.9), T('xp-energy', 'xpEnergy', 'high', 30, 40),
  T('xp-lock', 'xpLock', 'low', 90, 75), T('xp-pattern', 'xpPattern', 'low', 98, 95),
  T('carrier-weak', 'carrier', 'low', 25, 12), T('comms-delay', 'delay', 'high', 10, 30),
  T('comms-loss', 'loss', 'high', 10, 30), T('interference', 'interference', 'high', 30, 60),
  T('crew-watch', 'crewWatch', 'high', 15, 60), T('crew-critical', 'crewCritical', 'high', 0, 5),
];
export const RULES = {
  thresholds: [...shipRules, ...crewRules],
  // Also watched by the rolling z-score detector. `contactSnr` has no fixed limit on purpose: the sensor ghost in
  // Balance of Terror is too weak for a threshold and only the statistics catch it.
  zChannels: [
    'chamberTemp', 'reactionRate', 'dilithiumTemp', 'impulseTemp', 'contactSnr', 'carrier', 'xpEnergy', 'crewMeanHr',
    ...Array.from({ length: CREW_SIZE }, (_, i) => pad(i + 1, 3)).flatMap((n) => [`hr_${n}`, `nr_${n}`]),
  ],
};

/** Stardate: ten units a day from 1 Jan 2026, about 4180 in mid-November 2026. */
export const stardate = (ts) => 1000 + (ts - Date.UTC(2026, 0, 1)) / 8_640_000;
