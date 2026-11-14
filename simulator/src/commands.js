// The command hook. The server relays commands to a ship's simulator as `sim:command` events ({ type, args });
// Ship.command() looks the type up here. Three families:
//   bridge commands     helm.*, tactical.*, ship.condition, comms.*, engineering.*, transporter.*, medical.*, science.*, security.*
//   scenario verbs      scn.* (set, ramp, noise, hit, contact, crew, snap, release): what a scenario script does to the ship
//   fault injection     fault (one channel), clear, fault.spike; the stream faults (mute, fault.storm, scn.rogue) live in index.js
import { CHANNEL_BY_KEY } from '@ncc/shared/schema.js';

const crewVerb = (ship, a) => {
  const c = ship.crew;
  if (a.infect) a.infect.forEach((n) => c.infect(n));
  if (a.spread !== undefined) (a.spread ? c.startSpread(typeof a.spread === 'object' ? a.spread : {}) : c.stopSpread());
  if (a.recover !== undefined) c.recover(a.recover, a.over ?? 20);
  if (a.shift) c.shift(a.shift.ids, a.shift);
  if (a.set) c.setTargets(a.set.ids, a.set, a.set.infected ? 'infected' : 'shift');
  if (a.sedate) c.setTargets({ deck: a.sedate }, { hr: 55, nr: 50 });
  if (a.quarantine) c.quarantine(a.quarantine);
  if (a.aboard !== undefined) c.aboard = a.aboard;
};

export const COMMANDS = {
  // ---- bridge ----
  'helm.warp': (s, { factor }) => s.setWarp(factor),
  'helm.impulse': (s, { percent }) => s.setImpulse(percent),
  'helm.heading': (s, a) => s.setHeading(a),
  'helm.stop': (s) => {
    s.order.warp = 0;
    s.order.impulse = 0;
  },
  'tactical.shields': (s, { up }) => {
    s.shieldsUp = !!up;
  },
  'tactical.phasers': (s, { bank }) => s.firePhasers(bank),
  'tactical.torpedo': (s) => s.fireTorpedo(),
  'ship.condition': (s, { level }) => s.setCondition(level),
  'comms.hail': (s) => {
    s.s.hailing = 1;
  },
  'comms.close': (s) => {
    s.s.hailing = 0;
  },
  'engineering.allocate': (s, { preset }) => s.setPreset(preset),
  'engineering.coldRestart': () => {}, // the scenario script restarts the core; nothing in calm running
  'transporter.energize': (s) => s.energize(),
  'medical.inoculate': (s, { deck }) => {
    s.crew.recover(deck ? { deck } : 'all', 20, 'infected');
    if (!deck) s.crew.stopSpread(); // a ship-wide inoculation ends the outbreak
  },
  'medical.quarantine': (s, { deck }) => s.crew.quarantine(deck),
  'science.scan': (s, { mode }) => s.scan(mode),
  'security.ventGas': () => {}, // as the cold restart: the scenario script sedates the crew

  // ---- scenario verbs ----
  'scn.set': (s, { ch, to, value }) => s.override(ch, to ?? value, 0),
  'scn.ramp': (s, { ch, to, over }) => s.override(ch, to, over ?? 1),
  'scn.noise': (s, { ch, sigma }) => s.noise(ch, sigma),
  'scn.hit': (s, { quad = 'all', amount = 20, hull = 0 }) => s.hit(quad, amount, hull),
  'scn.contact': (s, a) => s.contact(a),
  'scn.crew': crewVerb,
  'scn.snap': (s, a) => s.snap(a),
  'scn.release': (s, { over = 10, ch }) => s.release(over, ch ? [].concat(ch) : null),

  // ---- fault injection ----
  /** args: { channel, target, rampSec = 20 }. Moves one channel to `target` over rampSec seconds and holds it there. */
  fault(ship, { channel, target, rampSec = 20 }) {
    const c = CHANNEL_BY_KEY[channel];
    if (!c || !Number.isFinite(target)) return;
    ship.faults.set(channel, { target: Math.min(c.max, Math.max(c.min, target)), at: ship.lastTs || Date.now(), rampSec: Math.max(0.1, rampSec) });
  },
  /** Removes every fault: channels go back to nominal. */
  clear(ship) {
    ship.faults.clear();
    for (const [key, ov] of ship.ov) if (ov.until !== undefined) ship.ov.delete(key);
  },
  /** A short outlier on the reaction rate: 3 s, then it drifts back. */
  'fault.spike'(ship) {
    const now = ship.out.reactionRate ?? 64;
    ship.ov.set('reactionRate', { from: now, to: now + 38, t0: ship.t, over: 0.3, until: ship.t + 3 });
  },
};

/** Stream-level commands (about sending, not about values) are handled by index.js: `mute` with { seconds }, `fault.storm` with { seconds }, `scn.fault`, `scn.rogue`. */
export const STREAM_COMMANDS = new Set(['mute', 'fault.storm', 'scn.fault', 'scn.rogue']);
