// Live data layer: one socket per tab, reference-counted room subscriptions, per-source per-group
// ring buffers kept outside React state. Components read these on a throttled tick (hooks.js useTick) or in the
// shared requestAnimationFrame loop (raf.js). Domain-neutral: groups, channels and scales come from the registry.
import { io } from 'socket.io-client';
import parser from 'socket.io-msgpack-parser';
import { CHANNEL_BY_KEY, GROUP_CHANNELS } from '@ncc/shared/schema.js';
import { API, api } from './api.js';
import { Ring } from './ring.js';

const scaleOf = (key) => CHANNEL_BY_KEY[key].scale;

export { Ring };

// ---- shared state -------------------------------------------------------
export const state = {
  status: 'connecting', // connecting | online | offline
  authError: false,
  hadConnection: false,
  rings: new Map(), // "sourceId:group" -> Ring
  overview: new Map(), // sourceId -> { flags } (bit 0 online, bit 1 warn alert open, bit 2 critical alert open)
  overviewAt: 0,
  overviewPrimed: false, // false until the first overview after (re)connecting
  alerts: [], // newest first
  rx: null, // readings the server accepted in the last second
  metrics: { latest: null, ver: 0 }, // Starfleet Command only
};
export const stats = { framesIn: 0, framesPerSec: 0, overviewIn: 0, overviewPerSec: 0, gapFilled: 0, reconnects: 0 };
const frameListeners = new Set();
export const onFrameRows = (fn) => { frameListeners.add(fn); return () => frameListeners.delete(fn); };
const alertListeners = new Set();
// live alerts only (not the ones loaded from history on sign-in)
export const onAlert = (fn) => { alertListeners.add(fn); return () => alertListeners.delete(fn); };
const connListeners = new Set();
// fn('offline') when the socket drops, fn('online', { reconnect }) when it is back and its rooms are re-joined
export const onConnection = (fn) => { connListeners.add(fn); return () => connListeners.delete(fn); };
let authLost = () => {};
export const setAuthLostHandler = (fn) => { authLost = fn; };

export const getRing = (sourceId, group) => state.rings.get(`${sourceId}:${group}`);
function ensureRing(sourceId, group, keys) {
  const id = `${sourceId}:${group}`;
  let r = state.rings.get(id);
  if (!r) { r = new Ring(keys); state.rings.set(id, r); }
  return r;
}

let lastFrames = 0, lastOverviews = 0;
setInterval(() => {
  stats.framesPerSec = stats.framesIn - lastFrames; lastFrames = stats.framesIn;
  stats.overviewPerSec = stats.overviewIn - lastOverviews; lastOverviews = stats.overviewIn;
}, 1000);

// ---- socket -------------------------------------------------------------
let socket = null;
const refs = new Map(); // "sourceId:group" -> number of components using the room
const acked = new Set(); // rooms the server confirmed joining on this connection
const waiters = new Set(); // { keys, resolve } waiting for rooms to be confirmed
const gen = new Map(); // "sourceId:group" -> number of the latest join or leave request for that room

export function connect(token) {
  if (socket) return;
  state.status = 'connecting';
  state.authError = false;
  socket = io(`${API}/live`, { parser, auth: { token }, transports: ['websocket'], reconnectionDelayMax: 3000 });
  socket.on('connect', () => {
    const isReconnect = state.hadConnection;
    state.status = 'online';
    state.hadConnection = true;
    state.overviewPrimed = false;
    // read where each chart stopped (before a drop, or a backfill made while offline) before any new frame
    // lands, then re-join the rooms and fetch the gap
    const gaps = gapStarts();
    resubscribeAll();
    if (gaps.size) whenSubscribed().then(() => fillGaps(gaps));
    if (isReconnect) stats.reconnects++;
    connListeners.forEach((fn) => fn('online', { reconnect: isReconnect }));
  });
  socket.on('disconnect', () => {
    state.status = 'offline';
    acked.clear(); // the server forgets this socket's rooms
    connListeners.forEach((fn) => fn('offline'));
  });
  socket.on('connect_error', () => {
    state.status = 'offline';
    // A refused handshake (expired or invalid sign-in) is final: Socket.IO stops retrying, so sign the user out.
    if (!socket.active) { state.authError = true; authLost(); }
  });
  socket.on('telemetry:frame', onFrame);
  socket.on('overview', onOverview);
  socket.on('alert', (a) => addAlert(a, true));
  socket.on('alert:ack', ({ id, by }) => { const a = state.alerts.find((x) => x.id === id); if (a) a.ack = { by, at: Date.now() }; });
  socket.on('metrics', (m) => { state.metrics.latest = m; state.metrics.ver++; });
}

// Sign-out: close the socket and forget everything this user could see, so the next user starts clean.
export function disconnect() {
  socket?.disconnect();
  socket = null;
  state.hadConnection = false;
  state.overviewPrimed = false;
  for (const m of [state.rings, state.overview, refs, gen]) m.clear();
  acked.clear();
  state.alerts.length = 0;
  state.rx = null;
  Object.assign(state.metrics, { latest: null, ver: state.metrics.ver + 1 });
  state.status = 'connecting';
}

function addAlert(a, live = false) {
  if (state.alerts.some((x) => x.id === a.id)) return;
  if (live) a.arrivedAt = Date.now(); // lists can highlight an alert that just arrived
  state.alerts.unshift(a);
  if (state.alerts.length > 2000) state.alerts.length = 2000;
  if (live) alertListeners.forEach((fn) => fn(a));
}
export function seedAlerts(list) {
  for (const a of [...list].sort((x, y) => x.ts - y.ts)) addAlert(a);
  state.alerts.sort((a, b) => b.ts - a.ts);
}

/** Acknowledges an alert over the socket; resolves { ok, error? }. */
export function ackAlert(id) {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve({ ok: false, error: 'offline' });
    socket.emit('alert:ack', { id }, resolve);
  });
}

// ---- subscriptions (reference counted) ---------------------------------
// A room is joined when its first user mounts and left when the last one unmounts. Each join or leave request
// carries a number per room, so a late reply to an older request can never mark a room as joined.
export function subscribe(sourceIds, groups) {
  const joined = [];
  for (const c of sourceIds) for (const g of groups) {
    const k = `${c}:${g}`;
    const n = refs.get(k) || 0;
    refs.set(k, n + 1);
    if (n === 0) joined.push([c, g]);
  }
  emitRooms('subscribe', joined);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = [];
    for (const c of sourceIds) for (const g of groups) {
      const k = `${c}:${g}`;
      const n = (refs.get(k) || 1) - 1;
      if (n <= 0) { refs.delete(k); acked.delete(k); left.push([c, g]); } else refs.set(k, n);
    }
    emitRooms('unsubscribe', left);
  };
}
export const activeRooms = () => [...refs.keys()];

// Resolves once the server has confirmed every listed room (all rooms in use when called without arguments).
// History must be fetched after this: a sample stored between the fetch and the join would be in neither.
// Without a live connection there is nothing to race: it resolves at once, and the page fills its gap when
// the socket connects.
export function whenSubscribed(sourceIds, groups) {
  if (!socket?.connected) return Promise.resolve();
  const keys = sourceIds ? sourceIds.flatMap((c) => groups.map((g) => `${c}:${g}`)) : [...refs.keys()];
  if (keys.every((k) => acked.has(k))) return Promise.resolve();
  return new Promise((resolve) => waiters.add({ keys, resolve }));
}
function settleWaiters() {
  for (const w of waiters) if (w.keys.every((k) => acked.has(k) || !refs.has(k))) { waiters.delete(w); w.resolve(); }
}

// One request per source with all its groups, so stepping through sources stays within the server's limit on room
// changes (20 a second per socket). A rate-limited request is sent again while it is still the latest for its rooms.
function emitRooms(event, pairs) {
  if (!pairs.length || !socket?.connected) return;
  const bySource = new Map();
  for (const [c, g] of pairs) bySource.set(c, [...(bySource.get(c) || []), g]);
  for (const [c, groups] of bySource) {
    const keys = groups.map((g) => `${c}:${g}`);
    const mine = keys.map((k) => { const n = (gen.get(k) || 0) + 1; gen.set(k, n); return n; });
    socket.emit(event, { sourceIds: [c], groups }, (res) => {
      const latest = keys.filter((k, i) => gen.get(k) === mine[i]); // no newer request has replaced these
      if (res?.error === 'rate limited') { setTimeout(() => emitRooms(event, latest.map((k) => [c, k.slice(k.indexOf(':') + 1)])), 400); return; }
      if (event !== 'subscribe') return;
      // joined, or refused for good (a group this role may not see): either way the page stops waiting
      for (const k of latest) if (refs.has(k)) acked.add(k);
      settleWaiters();
    });
  }
}
function resubscribeAll() { emitRooms('subscribe', [...refs.keys()].map((k) => k.split(':').map((v, i) => (i ? v : Number(v))))); }

// ---- incoming data ------------------------------------------------------
function onFrame({ sourceId, group, keys, samples }) {
  stats.framesIn++;
  const ring = ensureRing(sourceId, group, keys);
  const rows = [];
  for (const s of samples) {
    const row = new Array(s.length);
    row[0] = s[0]; row[1] = s[1];
    for (let i = 0; i < keys.length; i++) row[i + 2] = s[i + 2] / scaleOf(keys[i]);
    if (ring.push(row)) rows.push(row);
  }
  if (rows.length) frameListeners.forEach((fn) => fn(sourceId, group, keys, rows));
}

function onOverview({ sources, rx }) {
  stats.overviewIn++;
  state.overviewAt = performance.now();
  if (rx != null) state.rx = rx;
  // row: [sourceId, flags]. The server lists only sources heard from in the last 5 s: one missing here has left.
  const listed = new Set();
  for (const [id, flags] of sources) { listed.add(id); state.overview.set(id, { flags }); }
  for (const [id, e] of state.overview) if (!listed.has(id)) e.flags = 0;
  state.overviewPrimed = true;
}

// Where each source's charts stopped, read when the socket comes back and before any live frame lands.
function gapStarts() {
  const now = Date.now();
  const out = new Map();
  for (const sourceId of new Set([...refs.keys()].map((k) => Number(k.split(':')[0])))) {
    const rings = [...state.rings].filter(([k]) => k.startsWith(`${sourceId}:`)).map(([, r]) => r);
    // the charts show the last minute only
    if (rings.length) out.set(sourceId, { rings, from: Math.max(Math.min(...rings.map((r) => r.lastTs)) - 1, now - 60000) });
  }
  return out;
}

const toRow = (res, keys) => {
  const idx = keys.map((k) => res.keys.indexOf(k) + 2);
  return (s) => [s[0], s[1], ...idx.map((ix, i) => s[ix] / scaleOf(keys[i]))];
};

// After a reconnect: the rooms were re-joined; now fetch what was missed from history and merge it
// in by seq. Live frames reach the rings before the history reply and move lastSeq past the gap,
// so appending only newer samples would drop the whole gap.
function fillGaps(gaps) {
  for (const [sourceId, { rings, from }] of gaps) {
    api('/api/telemetry', { query: { sourceId, from, to: Date.now() + 1000, maxPoints: 5000 } })
      .then((res) => {
        for (const ring of rings) {
          if (!ring.keys.every((k) => res.keys.includes(k))) continue; // a role that lost access to a group
          stats.gapFilled += ring.merge(res.samples.map(toRow(res, ring.keys)));
        }
      })
      .catch(() => { /* server still unreachable; the next reconnect retries */ });
  }
}

// Fill a source's rings with the last `ms` of history so a freshly opened page is not empty.
// Merge rule: live frames that arrived meanwhile are kept only when their seq is above the
// history's lastSeq; history is then written first and the live rows appended after it.
export async function backfill(sourceId, groups, ms = 60000) {
  const now = Date.now();
  const res = await api('/api/telemetry', { query: { sourceId, from: now - ms, to: now + 1000, maxPoints: 4000, keys: groups.flatMap((g) => GROUP_CHANNELS[g]).join(',') } });
  for (const g of groups) {
    const ring = ensureRing(sourceId, g, GROUP_CHANNELS[g]);
    const live = ring.rows(res.lastSeq);
    ring.reset();
    const row = toRow(res, ring.keys);
    for (const s of res.samples) ring.push(row(s));
    for (const r of live) ring.push(r);
  }
}

// Dev only: lets a test script close the transport to exercise the reconnect and gap-fill path.
if (import.meta.env.DEV) window.__ncc = { state, stats, drop: () => socket?.io.engine.close() };
