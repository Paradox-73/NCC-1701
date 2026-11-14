// What the server says about a ship beyond its telemetry (docs/PROTOCOL.md, Ship routes and events): condition,
// the captain's log, scenario progress and visual cues. Socket events keep it current; GET /api/ships/:id/state fills
// it in for a dashboard that joins late. Read it on a tick (hooks.js useTick); it is not React state.
import { stardate as baseStardate } from '@ncc/shared/schema.js';
import { api } from './api.js';
import { commandWords, onCommandResult } from './commands.js';
import { play } from './sound.js';
import { onConnection, onEvent, state } from './store.js';

export const LEVELS = ['normal', 'yellow', 'red'];
const SHIP = 1;
const pushed = new Map(); // shipId -> { level, at }: the latest condition event
const PUSH_MS = 1500; // an event beats the overview this long, so an overview sent before the change cannot undo it
export const ship = {
  scenario: null, // the latest `scenario` payload, or null
  stardateOffset: 0, // a time warp shifts the ship's stardate
  scene: null, // a viewscreen scene a scenario asked for (psi-2000, planet-closing, halkan)
  warpFx: 0, // performance.now() until which the viewscreen shows a time-warp streak
};

/** The ship's stardate: ten units a day, plus any time-warp offset. */
export const stardate = (ts = Date.now()) => baseStardate(ts) + ship.stardateOffset;

/** 'normal' | 'yellow' | 'red' for a ship. */
export function conditionOf(shipId = SHIP) {
  const p = pushed.get(shipId);
  if (p && performance.now() - p.at < PUSH_MS) return p.level;
  return state.overview.get(shipId)?.condition ?? p?.level ?? 'normal';
}

// ---- the captain's log: server log lines and this user's command results, newest first --------------------
export const shipLog = [];
const seen = new Set();
const add = (e) => {
  const key = `${e.ts}|${e.text}`;
  if (seen.has(key)) return;
  seen.add(key);
  shipLog.unshift(e);
  shipLog.sort((a, b) => b.ts - a.ts);
  if (shipLog.length > 300) shipLog.length = 300;
};
const logLine = (l, fresh) => add({ id: `${l.ts}-${l.text}`, kind: l.by === 'scenario' ? 'scenario' : 'log', ts: l.ts ?? Date.now(), text: l.text ?? '', by: l.by, fresh });

const CUE = { chirp: 'chirp', alarm: 'red', klaxon: 'yellow', warp: 'warp', boom: 'boom' };
onEvent('condition', (p) => { if (LEVELS.includes(p?.level)) pushed.set(Number(p.shipId ?? SHIP), { level: p.level, at: performance.now() }); });
onEvent('log', (l) => {
  if (Number(l?.shipId ?? SHIP) !== SHIP) return;
  logLine(l, true);
  if (l.sound) play(CUE[l.sound] ?? l.sound);
  else if (l.by === 'log') play('intercom'); // a scenario script line (runner.js sends by: 'log')
});
onEvent('scenario', (s) => { ship.scenario = s; if (s?.state === 'ended' || s?.state === 'stopped') ship.scene = null; });
onEvent('fx', (f) => {
  if (Number(f?.shipId ?? SHIP) !== SHIP) return;
  if (f.name === 'timewarp') { ship.stardateOffset += f.stardateDelta ?? 0; ship.warpFx = performance.now() + 2500; play('warp'); }
  if (f.name === 'viewscreen') ship.scene = f.scene ?? null;
  if (f.name === 'sound') play(CUE[f.sound] ?? f.sound);
});
onCommandResult((r) => {
  if (r.ok) return; // an accepted command comes back from the server as a log line
  add({ id: `c${r.at}`, kind: 'command', ok: false, ts: r.at, text: `${commandWords(r.type, r.payload)}: ${r.error}`, fresh: true });
});

/** Fills condition, scenario and the last 60 log lines in from the server: on sign-in and after a reconnect. */
export async function loadShip(shipId = SHIP) {
  try {
    const s = await api(`/api/ships/${shipId}/state`);
    if (LEVELS.includes(s.condition)) pushed.set(shipId, { level: s.condition, at: performance.now() - PUSH_MS + 200 });
    ship.scenario = s.scenario ?? null;
    ship.stardateOffset = s.stardateOffset ?? 0;
    for (const l of s.log ?? []) logLine(l, false);
  } catch { /* the socket keeps it current anyway */ }
}
onConnection((st, info) => { if (st === 'online' && info?.reconnect) loadShip(); });

/** Clears what one signed-in user saw, so the next one starts clean. */
export function resetShip() {
  pushed.clear();
  shipLog.length = 0;
  seen.clear();
  Object.assign(ship, { scenario: null, stardateOffset: 0, scene: null, warpFx: 0 });
}

// Dev only: show a condition without a server that sends one (`__nccShip.condition('red')` in the console).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__nccShip = { condition: (level, id = SHIP) => pushed.set(id, { level, at: performance.now() + 1e9 }), ship, shipLog };
}
