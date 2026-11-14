// Telemetry wire format shared by the simulator, the server and the dashboard. It reads registry.js and holds
// no domain content of its own.
//
// A sample travels as a flat array of integers: [seq, ts, v0, v1, ...].
// seq  - per-source sequence number, starts at 1 and increases by 1 per sample
// ts   - sample time in milliseconds since the Unix epoch (set by the source)
// vN   - channel value multiplied by the channel's `scale` and rounded, in the order of CHANNELS in registry.js.
// Integers keep MessagePack frames small (1-3 bytes per value instead of 9).

import { CHANNELS, GROUP_DEFS, ROLES } from './registry.js';

export { CHANNELS, GROUP_DEFS, ROLES, RULES, SOURCES } from './registry.js';

export const GROUPS = GROUP_DEFS.map((g) => g.key);
export const SAMPLE_LEN = 2 + CHANNELS.length;
export const CHANNEL_INDEX = Object.fromEntries(CHANNELS.map((c, i) => [c.key, i + 2]));
export const CHANNEL_BY_KEY = Object.fromEntries(CHANNELS.map((c) => [c.key, c]));
export const GROUP_CHANNELS = Object.fromEntries(GROUPS.map((g) => [g, CHANNELS.filter((c) => c.group === g).map((c) => c.key)]));

/** Groups a role may see; an unknown role sees none. */
export const roleGroups = (role) => ROLES[role]?.groups ?? [];
/** True when the role may see the group. A null group (not tied to a channel group, such as link loss) is visible to every role. */
export const canSeeGroup = (role, group) => group == null || roleGroups(role).includes(group);

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
  COMMAND: 'sim:command', // { type: string, ...fields }: the command channel to a simulated source; scenario scripts plug in here
  // client <-> server, namespace /live
  SUBSCRIBE: 'subscribe', // { sourceIds: number[], groups: string[] }, ack({ ok, rooms, denied })
  UNSUBSCRIBE: 'unsubscribe', // { sourceIds: number[], groups?: string[] }
  FRAME: 'telemetry:frame', // { sourceId, group, keys: string[], samples: [[seq, ts, ...values for keys]] }
  OVERVIEW: 'overview', // { ts, sources: [[sourceId, flags]], rx }  (volatile; flags bit 0 = online, bit 1 = warn alert open, bit 2 = critical alert open; rx = readings accepted per second)
  ALERT: 'alert', // alert document, see server/src/models/index.js
  ALERT_ACK: 'alert:ack', // { id, by }
  METRICS: 'metrics', // server counters, about 1 Hz, admins only
};

export function packSample(seq, ts, values) {
  const out = new Array(SAMPLE_LEN);
  out[0] = seq;
  out[1] = ts;
  for (let i = 0; i < CHANNELS.length; i++) {
    const c = CHANNELS[i];
    out[i + 2] = Math.round(values[c.key] * c.scale);
  }
  return out;
}

export function unpackSample(arr) {
  const s = { seq: arr[0], ts: arr[1] };
  for (let i = 0; i < CHANNELS.length; i++) s[CHANNELS[i].key] = arr[i + 2] / CHANNELS[i].scale;
  return s;
}

// Returns null when the packed sample is well formed, not stamped more than LIMITS.maxFutureMs
// after `now` and inside every channel's range, otherwise a short reason string.
// Used by the server before anything is stored.
export function checkPacked(arr, now = Date.now()) {
  if (!Array.isArray(arr) || arr.length !== SAMPLE_LEN) return 'length';
  if (!Number.isSafeInteger(arr[0]) || arr[0] < 1) return 'seq'; // larger seqs lose precision and break the dedup window
  if (!Number.isInteger(arr[1]) || arr[1] < 1e12 || arr[1] > now + LIMITS.maxFutureMs) return 'ts';
  for (let i = 0; i < CHANNELS.length; i++) {
    const v = arr[i + 2];
    const c = CHANNELS[i];
    if (!Number.isInteger(v)) return c.key;
    if (v < Math.round(c.min * c.scale) || v > Math.round(c.max * c.scale)) return c.key;
  }
  return null;
}
