// Ship commands (DOMAIN.md section 7): POST /api/ships/:id/command with { type, ...payload }. The server validates,
// checks the role, rate-limits and relays to the simulator; its reply is the acknowledgement. While a command of a
// type is in flight, every LitButton bound to that type blinks, whether a click or a key sent it.
import { useSyncExternalStore } from 'react';
import { api } from './api.js';
import { play } from './sound.js';

const inflight = new Map(); // type -> number of requests in flight
const listeners = new Set();
const resultListeners = new Set();
let version = 0;
const notify = () => { version++; listeners.forEach((fn) => fn()); };
const bump = (type, d) => {
  const n = (inflight.get(type) || 0) + d;
  if (n > 0) inflight.set(type, n); else inflight.delete(type);
  notify();
};

/** Every command's outcome: { type, payload, ok, rtt, text, error, at }; `text` is the server's own words. The shell shows these as "aye" lines. */
export const onCommandResult = (fn) => { resultListeners.add(fn); return () => resultListeners.delete(fn); };

/** Sends a command; resolves { ok, rtt } or { ok: false, error }. Never throws. */
export async function sendCommand(type, payload = {}, shipId = 1) {
  bump(type, 1);
  const t0 = performance.now();
  let out;
  try {
    const res = await api(`/api/ships/${shipId}/command`, { method: 'POST', body: { type, ...payload } });
    out = { ok: true, rtt: Math.round(performance.now() - t0), at: res?.at ?? Date.now(), text: res?.text };
    play('ack');
  } catch (e) {
    out = { ok: false, error: e.message, at: Date.now() };
  } finally {
    bump(type, -1);
  }
  const result = { type, payload, shipId, ...out };
  resultListeners.forEach((fn) => fn(result));
  return result;
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
/** { pending, send } for one command type: bind `pending` to a LitButton so it blinks until the ack. */
export function useCommand(type, shipId = 1) {
  useSyncExternalStore(subscribe, () => version);
  return { pending: inflight.has(type), send: (payload) => sendCommand(type, payload, shipId) };
}

// Who may send what when the registry does not list commands per role yet (DOMAIN.md section 7).
const FALLBACK = { captain: /^(helm|tactical|ship|comms|engineering|transporter|medical|science|security|scenario)\./, communications_officer: /^comms\./, chief_engineer: /^(engineering|transporter)\./, chief_medical_officer: /^medical\./, science_officer: /^science\./, starfleet_command: /^(scenario|sim)\./ };
/** True when the user's role may send the command type (the server checks again). */
export function mayCommand(user, type) {
  if (Array.isArray(user.commands)) return user.commands.some((c) => c === type || (c.endsWith('.*') && type.startsWith(c.slice(0, -1))));
  return !!FALLBACK[user.role]?.test(type);
}

// "Warp factor 6, aye": the bridge's spoken acknowledgement for a command result.
const AYE = {
  'helm.warp': (p) => (p.factor ? `Warp factor ${p.factor}` : 'Drop to impulse'),
  'helm.impulse': (p) => (p.percent === 100 ? 'Full impulse' : `Impulse ${p.percent}%`),
  'helm.heading': (p) => (p.delta ? `Come ${Math.abs(p.delta)}° to ${p.delta < 0 ? 'port' : 'starboard'}` : `Heading ${p.deg}`),
  'helm.stop': () => 'All stop',
  'tactical.shields': (p) => (p.up ? 'Shields up' : 'Shields down'),
  'tactical.phasers': () => 'Fire phasers',
  'tactical.torpedo': () => 'Photon torpedo away',
  'ship.condition': (p) => ({ red: 'Red alert', yellow: 'Yellow alert', normal: 'Stand down' })[p.level],
  'comms.hail': () => 'Hailing frequencies open',
  'comms.close': () => 'Channel closed',
  'engineering.allocate': (p) => `${p.preset} power`,
  'engineering.coldRestart': () => 'Cold restart',
  'transporter.energize': () => 'Energize',
  'medical.inoculate': () => 'Inoculate',
  'medical.quarantine': (p) => `Quarantine deck ${p.deck}`,
  'science.scan': (p) => `${p.mode ?? ''} scan`,
  'security.ventGas': (p) => `Vent gas, deck ${p.deck}`,
  'scenario.start': (p) => `Scenario ${p.id?.replace(/-/g, ' ')}`,
  'scenario.stop': () => 'Scenario stopped',
};
export const commandWords = (type, payload = {}) => AYE[type]?.(payload) ?? type;
