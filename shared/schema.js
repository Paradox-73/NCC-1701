// Telemetry wire format shared by the simulator, the server and the dashboard. It reads registry.js and holds
// no domain content of its own.
//
// A sample travels as a flat array of integers: [seq, ts, v0, v1, ...].
// seq  - per-source sequence number, starts at 1 and increases by 1 per sample
// ts   - sample time in milliseconds since the Unix epoch (set by the source)
// vN   - channel value multiplied by the channel's `scale` and rounded, in the order of the source kind's channel
//        list (KINDS[kind].channels in registry.js). A source's kind comes from its id: kindOf(sourceId).
// Integers keep MessagePack frames small (1-3 bytes per value instead of 9).

import { CHANNELS, GROUP_DEFS, KINDS, ROLES, SOURCES } from './registry.js';

export { CHANNELS, GROUP_DEFS, KINDS, ROLES, RULES, SOURCES, CREW_SIZE, DECKS, DECK_NAMES, ESCALATING_GROUPS, crewLabel, deckOfCrew, deptOfCrew, pad, roleMayCommand, stardate, VITAL_KEYS } from './registry.js';

export const GROUPS = GROUP_DEFS.map((g) => g.key);
export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
export const CHANNEL_BY_KEY = Object.fromEntries(CHANNELS.map((c) => [c.key, c]));
/** Channel keys of every group. Group keys never repeat across kinds. */
export const GROUP_CHANNELS = Object.fromEntries(GROUPS.map((g) => [g, CHANNELS.filter((c) => c.group === g).map((c) => c.key)]));
export const GROUP_KIND = Object.fromEntries(GROUP_DEFS.map((g) => [g.key, g.kind]));

/** 'ship' or 'crew'. An id outside the registry (a load-test source) counts as a ship. */
export const kindOf = (sourceId) => SOURCE_BY_ID[sourceId]?.kind ?? 'ship';
export const isCrewSource = (sourceId) => kindOf(sourceId) === 'crew';
/** The ship a source belongs to: itself for a ship, the ship its sickbay serves for a crew hub. */
export const shipOf = (sourceId) => SOURCE_BY_ID[sourceId]?.ship ?? sourceId;
/** Source ids of the ships, and the crew hub of a ship. */
export const SHIP_IDS = SOURCES.filter((s) => s.kind === 'ship').map((s) => s.id);
export const crewHubOf = (shipId) => SOURCES.find((s) => s.kind === 'crew' && s.ship === shipId)?.id ?? null;

const KIND_INFO = Object.fromEntries(
  Object.entries(KINDS).map(([name, k]) => [name, { channels: k.channels, len: 2 + k.channels.length, index: Object.fromEntries(k.channels.map((c, i) => [c.key, i + 2])) }]),
);
/** The channel list of a source, its packed sample length and the column of each key in a packed sample. */
export const channelsOf = (sourceId) => KIND_INFO[kindOf(sourceId)].channels;
export const sampleLen = (sourceId) => KIND_INFO[kindOf(sourceId)].len;
export const channelIndex = (sourceId) => KIND_INFO[kindOf(sourceId)].index;
/** Groups of a source's kind. */
export const groupsOf = (sourceId) => KINDS[kindOf(sourceId)].groups;

/** Groups a role may see; an unknown role sees none. */
export const roleGroups = (role) => ROLES[role]?.groups ?? [];
/** True when the role may see the group. A null group (not tied to a channel group, such as link loss) is visible to every role. */
export const canSeeGroup = (role, group) => group == null || roleGroups(role).includes(group);
/** True when the role may see the source. A source outside the registry (a load-test source, a rogue one) is for admins only. */
export const canSeeSource = (role, sourceId) => (SOURCE_BY_ID[sourceId] ? !!ROLES[role]?.ships.includes(sourceId) : !!ROLES[role]?.admin);

// Limits enforced by the server; the simulator and load test read them too.
export const LIMITS = {
  maxSamplesPerBatch: 100,
  maxSourceId: 99,
  // token bucket per source: sustained samples per second and burst size
  sourceRatePerSec: 120,
  sourceBurst: 240,
  // samples whose seq is this far behind the newest seen are dropped as stale
  reorderWindow: 256,
  // samples stamped further ahead of the server clock than this are invalid (allowance for clock skew)
  maxFutureMs: 30_000,
};

export const EVENTS = {
  // source -> server, namespace /ingest
  BATCH: 'telemetry:batch', // payload { sourceId, samples: [[seq, ts, ...], ...] }, ack({ ok, accepted, duplicates, stale, invalid, throttled, credit })
  // server -> source, namespace /ingest
  COMMAND: 'sim:command', // { type: string, args }: the command channel to a simulated source; the scenario runner and the ship command route use it
  // client <-> server, namespace /live
  SUBSCRIBE: 'subscribe', // { sourceIds: number[], groups: string[] }, ack({ ok, rooms, denied, deniedSources })
  UNSUBSCRIBE: 'unsubscribe', // { sourceIds: number[], groups?: string[] }
  FRAME: 'telemetry:frame', // { sourceId, group, keys: string[], samples: [[seq, ts, ...values for keys]] }
  OVERVIEW: 'overview', // { ts, sources: [[sourceId, flags, condition, warp*100, weakestShield*10, posX*10, posY*10, heading*10]], rx } (volatile; one row per ship; flags bit 0 = online, bit 1 = warn alert open, bit 2 = critical alert open; condition 0 normal, 1 yellow, 2 red)
  ALERT: 'alert', // alert document, see server/src/models/index.js
  ALERT_ACK: 'alert:ack', // { id, by }
  METRICS: 'metrics', // server counters, about 1 Hz, admins only
  // room ship:<id>, namespace /live
  SHIP_CONDITION: 'condition', // { shipId, level: 'normal' | 'yellow' | 'red', by, ts }
  SHIP_LOG: 'log', // { shipId, ts, stardate, text, sound?, by }
  SCENARIO: 'scenario', // { state: 'running' | 'awaiting' | 'ended' | 'stopped', id, title, shipIds, t, step, steps, duration, awaiting, ts }
  COMMAND_ACK: 'command:ack', // { shipId, type, args, by, role, ok, at, text }
  SHIP_FX: 'fx', // { shipId, ts, name, ...fields }: a visual cue, for example 'timewarp' with stardateDelta
};

export const CONDITIONS = ['normal', 'yellow', 'red'];

export function packSample(seq, ts, values, sourceId = 1) {
  const chans = channelsOf(sourceId);
  const out = new Array(2 + chans.length);
  out[0] = seq;
  out[1] = ts;
  for (let i = 0; i < chans.length; i++) {
    const c = chans[i];
    out[i + 2] = Math.round(values[c.key] * c.scale);
  }
  return out;
}

export function unpackSample(arr, sourceId = 1) {
  const chans = channelsOf(sourceId);
  const s = { seq: arr[0], ts: arr[1] };
  for (let i = 0; i < chans.length; i++) s[chans[i].key] = arr[i + 2] / chans[i].scale;
  return s;
}

// Returns null when the packed sample is well formed, not stamped more than LIMITS.maxFutureMs
// after `now` and inside every channel's range, otherwise a short reason string.
// Used by the server before anything is stored.
export function checkPacked(arr, now = Date.now(), sourceId = 1) {
  const chans = channelsOf(sourceId);
  if (!Array.isArray(arr) || arr.length !== 2 + chans.length) return 'length';
  if (!Number.isSafeInteger(arr[0]) || arr[0] < 1) return 'seq'; // larger seqs lose precision and break the dedup window
  if (!Number.isInteger(arr[1]) || arr[1] < 1e12 || arr[1] > now + LIMITS.maxFutureMs) return 'ts';
  for (let i = 0; i < chans.length; i++) {
    const v = arr[i + 2];
    const c = chans[i];
    if (!Number.isInteger(v)) return c.key;
    if (v < Math.round(c.min * c.scale) || v > Math.round(c.max * c.scale)) return c.key;
  }
  return null;
}
