// Ship condition and the captain's log, from the server (DOMAIN.md sections 2, 5 and 8). The server owns the
// condition: a `condition` event on room ship:<id> changes it at once, and the 5 Hz overview row carries it too.
import { onCommandResult, commandWords } from './commands.js';
import { onEvent, state } from './store.js';

export const LEVELS = ['normal', 'yellow', 'red'];
const pushed = new Map(); // shipId -> { level, at }: the latest condition event
const PUSH_MS = 1500; // an event beats the overview this long, so an overview sent before the change cannot undo it

/** One stardate unit is 2.4 hours: ten a day, about 4170 in mid-November 2026 (DOMAIN.md, Stardate). */
export const stardate = (ts = Date.now()) => 1000 + (ts - Date.UTC(2026, 0, 1)) / 8_640_000;

const levelOf = (p) => (typeof p === 'string' ? p : p?.level ?? p?.condition);
const shipOf = (p) => Number(p?.shipId ?? p?.sourceId ?? 1);

/** 'normal' | 'yellow' | 'red' for a ship. Read it on a tick (useTick); it is not React state. */
export function conditionOf(shipId = 1) {
  const p = pushed.get(shipId);
  if (p && performance.now() - p.at < PUSH_MS) return p.level;
  return state.overview.get(shipId)?.condition ?? p?.level ?? 'normal';
}

// ---- the captain's log: log lines, scenario steps and command acknowledgements, newest first --------------
export const shipLog = [];
let seq = 0;
const add = (e) => {
  shipLog.unshift({ id: `l${++seq}`, ts: Date.now(), ...e });
  if (shipLog.length > 300) shipLog.length = 300;
};

onEvent('condition', (p) => {
  const level = levelOf(p);
  if (LEVELS.includes(level)) pushed.set(shipOf(p), { level, at: performance.now() });
});
onEvent('log', (p) => add({ kind: 'log', shipId: shipOf(p), ts: p?.ts ?? Date.now(), text: typeof p === 'string' ? p : p?.text ?? p?.message ?? '' }));
onEvent('scenario', (p) => { if (p?.log) add({ kind: 'scenario', shipId: shipOf(p), text: p.log }); });
onCommandResult((r) => add({
  kind: 'command', shipId: r.shipId, ok: r.ok,
  text: r.ok ? `${commandWords(r.type, r.payload)}, aye · ${r.rtt} ms` : `${commandWords(r.type, r.payload)}: ${r.error}`,
}));

/** Clears what one signed-in user saw, so the next one starts clean. */
export function resetShip() {
  pushed.clear();
  shipLog.length = 0;
}

// Dev only: show a condition without a server that sends one (`__ncc.condition('red')` in the console).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__nccShip = { condition: (level, id = 1) => pushed.set(id, { level, at: performance.now() }), log: (text) => add({ kind: 'log', shipId: 1, text }) };
}
