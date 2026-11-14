// One starship's physics. Every channel of the ship kind (shared/registry.js) is computed each step from a small
// state: orders from the bridge (warp, impulse, heading), the warp core and nacelles following the warp factor,
// shields per quadrant that fall under hits and recharge, phaser and torpedo state, a power allocation, hull, a
// life-support loop per deck, sensors, the transporter, subspace comms and the crew (crew.js).
//
// Noise is Ornstein-Uhlenbeck (a value pulled back toward a mean, with random kicks) where DOMAIN.md says so, and
// white sample noise on lagged outputs. A scenario never edits the state directly: it adds *overrides* on the output
// (set, ramp, extra noise) and calls events (hit, contact, crew). When it ends, overrides release back to the model
// over a few seconds, and reset() brings the state itself back to calm running.
import { CHANNEL_BY_KEY, DECKS, channelsOf, pad } from '@ncc/shared/schema.js';
import { COMMANDS } from './commands.js';
import { CrewModel } from './crew.js';

const CH = channelsOf(1);
const QUADS = ['Fore', 'Aft', 'Port', 'Stbd'];
export const PRESETS = { cruise: [55, 15, 10, 20], combat: [30, 35, 25, 10], emergency: [10, 40, 10, 40] };
const NOISE_THETA = 0.8; // correlation of scenario noise: a gust lasts about a second, so the z-score detector sees it

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lag = (x, target, tau, dt) => x + (target - x) * (1 - Math.exp(-dt / tau));
/** Exact Ornstein-Uhlenbeck step: stationary standard deviation is sigma / sqrt(2 theta). */
const ou = (x, mu, theta, sigma, dt, z) => {
  const e = Math.exp(-theta * dt);
  return mu + (x - mu) * e + sigma * Math.sqrt((1 - e * e) / (2 * theta)) * z;
};

const START = { 1: [0, 0], 2: [60, 40], 3: [-80, 55], 4: [35, -90] };

export class Ship {
  constructor(sourceId, { rand = Math.random } = {}) {
    this.sourceId = sourceId;
    this.rand = rand;
    this.t = 0;
    this.lastTs = 0;
    this.spare = null;
    this.ov = new Map(); // channel -> { from, to, t0, over } holding or ramping; { release: true, last, t0, over } drifting back
    this.nz = new Map(); // channel -> { sigma, x } extra correlated noise
    this.faults = new Map(); // channel -> { target, at, rampSec }: the old fault command, kept for the admin route
    this.crew = new CrewModel(sourceId, { rand });
    this.crewClock = 0;
    this.out = {};
    this.condition = 'normal';
    this.shieldsUp = false;
    this.preset = 'cruise';
    this.order = { warp: 6, impulse: 0, heading: 90 };
    const [x, y] = START[sourceId] ?? [0, 0];
    const s = (this.s = {
      warp: 6, impulse: 0, heading: 90, posX: x, posY: y,
      reaction: 64, dil: 98, dilTemp: 690, chamber: 44, impR: 0, impTemp: 300, inter: 0.8, field: 99,
      power: 82, al: [...PRESETS.cruise], battery: 100,
      sh: [100, 100, 100, 100], load: 10, phaser: { Fore: 100, Aft: 100 }, heat: 0, cooldown: 0, torpedoes: 24, tubes: 2, tubeClock: 0,
      hull: 100, hullHeal: 0, hullTemp: -10, stress: 10, kick: 0,
      o2: Array(DECKS).fill(20.9), co2: Array(DECKS).fill(600), temp: Array(DECKS).fill(21.5), press: Array(DECKS).fill(101.3), grav: Array(DECKS).fill(1),
      lr: 98.5, sr: 98.5, ion: 4, snr: 2,
      contact: { n: 0, bearing: 0, range: 1_000_000 }, cBearing: 0, cRange: 1_000_000, focusUntil: 0,
      xp: { phase: 0, t: 0 }, xpe: 0,
      carrier: 45, delay: 1.2, loss: 0.3, interf: 3, channels: 2, hailing: 0,
    });
  }

  gz() {
    if (this.spare !== null) {
      const z = this.spare;
      this.spare = null;
      return z;
    }
    const r = Math.sqrt(-2 * Math.log(1 - this.rand()));
    const a = 2 * Math.PI * this.rand();
    this.spare = r * Math.sin(a);
    return r * Math.cos(a);
  }

  /** Runs a command from the server (`sim:command`) through the handlers in commands.js. Returns false for an unknown type. */
  command(cmd) {
    const handler = COMMANDS[cmd?.type];
    if (!handler) return false;
    handler(this, cmd.args ?? {});
    return true;
  }

  // ---- orders and events --------------------------------------------------------------------------------------------
  setWarp(factor) {
    this.order.warp = factor;
    if (factor > 0) this.order.impulse = 0;
    else if (this.order.impulse === 0) this.order.impulse = 20; // dropping out of warp leaves the ship on impulse
  }

  setImpulse(percent) {
    this.order.impulse = percent;
    if (percent > 0) this.order.warp = 0;
  }

  setHeading({ deg, delta }) {
    this.order.heading = deg !== undefined ? deg : (((this.order.heading + delta) % 360) + 360) % 360;
  }

  setCondition(level) {
    this.condition = level;
    this.shieldsUp = level !== 'normal';
    if (level === 'red') this.setPreset('combat');
    else if (level === 'normal') this.setPreset('cruise');
  }

  setPreset(name) {
    if (PRESETS[name]) this.preset = name;
  }

  firePhasers(bank = 'fore') {
    const key = bank === 'aft' ? 'Aft' : 'Fore';
    const s = this.s;
    if (s.cooldown > 0 || s.phaser[key] < 40) return false;
    s.phaser[key] -= 40;
    s.heat += 12;
    s.cooldown = 1;
    return true;
  }

  fireTorpedo() {
    const s = this.s;
    if (s.tubes < 1 || s.torpedoes < 1) return false;
    s.tubes--;
    s.torpedoes--;
    return true;
  }

  energize() {
    const s = this.s;
    if (s.xp.phase !== 0) return false;
    s.xp = { phase: 1, t: 0 };
    return true;
  }

  scan(mode) {
    if (mode === 'focus') this.s.focusUntil = this.t + 10;
  }

  /** A hit: with shields up the quadrant loses `amount` and the generator load rises; with shields down the hull takes it. `hull` is extra damage that gets through. */
  hit(quad, amount, hull = 0) {
    const s = this.s;
    const idx = quad === 'all' ? [0, 1, 2, 3] : [QUADS.findIndex((q) => q.toLowerCase() === String(quad).toLowerCase())].filter((i) => i >= 0);
    for (const i of idx) {
      if (this.shieldsUp) {
        s.sh[i] = Math.max(0, s.sh[i] - amount);
      } else {
        s.hull = Math.max(0, s.hull - amount * 0.5);
      }
      s.kick += amount * 0.2;
    }
    if (this.shieldsUp) s.load += 10 + amount; // one jolt for the generator per hit, however many quadrants it spreads over
    if (hull) s.hull = Math.max(0, s.hull - hull);
  }

  /** `n` contacts tracked, the nearest at `bearing` degrees and `range` km; n 0 clears them. */
  contact({ n, bearing, range }) {
    const c = this.s.contact;
    if (n !== undefined) c.n = n;
    if (n === 0) c.range = 1_000_000;
    if (bearing !== undefined) c.bearing = bearing;
    if (range !== undefined) c.range = range;
  }

  /** Sets the operating point at once: orders and state (no lag). A scenario uses it to begin from a known point. */
  snap({ warp, impulse, heading } = {}) {
    const s = this.s;
    if (warp !== undefined) this.order.warp = s.warp = warp;
    if (impulse !== undefined) this.order.impulse = s.impulse = impulse;
    if (warp !== undefined && warp > 0 && impulse === undefined) this.order.impulse = s.impulse = 0;
    if (heading !== undefined) this.order.heading = s.heading = heading;
    s.reaction = 10 + 9 * s.warp;
    s.dilTemp = 450 + 40 * s.warp;
    s.chamber = 20 + 4 * s.warp;
    s.impR = s.impulse;
    s.impTemp = 300 + 3 * s.impR;
    s.power = 40 + 7 * s.warp + s.impulse * 0.2;
  }

  // ---- overrides ----------------------------------------------------------------------------------------------------
  /** Holds `key` at `to`, reaching it over `over` seconds from where it is now. */
  override(key, to, over = 0) {
    if (!CHANNEL_BY_KEY[key]) return;
    const from = this.out[key] ?? CHANNEL_BY_KEY[key].nominal;
    this.ov.set(key, { from, to, t0: this.t, over: Math.max(0, over) });
  }

  /** Adds correlated noise with standard deviation `sigma` to a channel; sigma 0 removes it. */
  noise(key, sigma) {
    if (!CHANNEL_BY_KEY[key]) return;
    if (!sigma) this.nz.delete(key);
    else this.nz.set(key, { sigma, x: this.nz.get(key)?.x ?? 0 });
  }

  /** The scenario ends: overrides and noise drift back to the model over `over` seconds, and the state returns to calm running. */
  release(over = 10, channels = null) {
    const mine = (key) => !channels || channels.includes(key);
    for (const [key, ov] of this.ov) if (!ov.release && mine(key)) this.ov.set(key, { release: true, last: this.out[key], t0: this.t, over });
    for (const [key, n] of this.nz) if (mine(key)) this.nz.set(key, { ...n, fadeFrom: this.t, fadeOver: over });
    if (!channels) this.reset(over);
  }

  reset(over = 10) {
    const s = this.s;
    this.order = { warp: 6, impulse: 0, heading: this.order.heading };
    this.setCondition('normal');
    this.crew.reset(over);
    s.contact = { n: 0, bearing: 0, range: 1_000_000 };
    s.hullHeal = (100 - s.hull) / over;
    s.hailing = 0;
    s.channels = 2;
    s.torpedoes = 24;
    s.kick = 0;
  }

  // ---- stepping -----------------------------------------------------------------------------------------------------
  /** Advances `dt` seconds and returns every ship channel's real value for the sample stamped `ts`. */
  step(dt, ts) {
    this.t += dt;
    this.lastTs = ts;
    const s = this.s;
    const o = this.order;
    const g = () => this.gz();
    const nat = {};

    // crew at 1 Hz
    this.crewClock += dt;
    if (this.crewClock >= 1) {
      this.crew.step(this.crewClock);
      this.crewClock = 0;
    }

    // helm
    s.warp = lag(s.warp, o.warp, 2, dt);
    if (o.warp === 0 && s.warp < 0.02) s.warp = 0;
    s.impulse = lag(s.impulse, o.impulse, 1, dt);
    const dh = ((o.heading - s.heading + 540) % 360) - 180;
    s.heading = (s.heading + clamp(dh, -3 * dt, 3 * dt) + 360) % 360;
    nat.warpFactor = s.warp > 0.005 ? Math.max(0, s.warp + 0.01 * g()) : 0;
    nat.impulse = s.impulse;
    nat.speed = s.warp > 0.05 ? s.warp ** 3 : (s.impulse / 100) * 0.25;
    nat.heading = s.heading;
    nat.orbitAlt = 0;
    nat.descentRate = 0;

    // warp core
    s.reaction = lag(s.reaction, 10 + 9 * s.warp, 1.5, dt);
    s.dil = clamp(s.dil + (s.warp > 8 ? -0.01 : 0.005) * dt, 0, 99);
    s.dilTemp = lag(s.dilTemp, 450 + 40 * s.warp, 5, dt);
    s.chamber = lag(s.chamber, 20 + 4 * s.warp, 3, dt);
    s.inter = ou(s.inter, 0.8, 0.5, 0.2, dt, g());
    s.field = ou(s.field, 99, 0.5, 0.2, dt, g());
    nat.reactionRate = s.reaction + 0.4 * g();
    nat.intermixDev = Math.abs(s.inter);
    nat.dilithiumEff = s.dil;
    nat.dilithiumTemp = s.dilTemp + 3 * g();
    nat.chamberTemp = s.chamber + 0.3 * g();
    nat.nacellePort = s.reaction * 0.98 + 0.5 * g();
    nat.nacelleStbd = s.reaction * 0.98 + 0.5 * g();
    nat.nacelleDelta = Math.abs(nat.nacellePort - nat.nacelleStbd);
    nat.warpField = Math.min(100, s.field);

    // impulse
    s.impR = lag(s.impR, s.impulse, 1, dt);
    s.impTemp = lag(s.impTemp, 300 + 3 * s.impR, 4, dt);
    nat.impulseReactor = Math.max(0, s.impR + 0.05 * g());
    nat.impulseTemp = s.impTemp + 2 * g();

    // shields
    for (let i = 0; i < 4; i++) {
      s.sh[i] = Math.min(100, s.sh[i] + 2 * dt);
      nat[`shield${QUADS[i]}`] = Math.min(99.9, s.sh[i] >= 99.9 ? 99.5 + 0.25 * g() : s.sh[i]);
    }
    s.load = lag(s.load, this.shieldsUp ? 35 : 10, 4, dt);
    nat.shieldsUp = this.shieldsUp ? 1 : 0;
    nat.shieldLoad = s.load + 0.3 * g();

    // weapons
    s.cooldown = Math.max(0, s.cooldown - dt);
    for (const k of ['Fore', 'Aft']) s.phaser[k] = Math.min(100, s.phaser[k] + 8 * dt);
    s.heat *= Math.exp(-dt / 20);
    if (s.tubes < 2 && s.torpedoes > s.tubes && (s.tubeClock += dt) >= 4) {
      s.tubes++;
      s.tubeClock = 0;
    }
    nat.phaserFore = s.phaser.Fore;
    nat.phaserAft = s.phaser.Aft;
    nat.phaserTemp = 30 + s.heat + 0.8 * g();
    nat.torpedoes = s.torpedoes;
    nat.tubesLoaded = s.tubes;

    // power
    const preset = PRESETS[this.preset];
    for (let i = 0; i < 4; i++) s.al[i] = lag(s.al[i], preset[i], 1, dt);
    s.power = lag(s.power, 40 + 7 * s.warp + s.impulse * 0.2, 2, dt);
    nat.powerTotal = s.power + 0.4 * g();
    [nat.allocWarp, nat.allocShields, nat.allocWeapons, nat.allocLife] = s.al.map((v) => v + 0.05 * g());
    // the battery follows the output the bridge sees, so a scenario that kills the engines drains it
    s.battery = clamp(s.battery + ((this.out.powerTotal ?? 82) < 25 ? -1 : 0.5) * dt, 0, 100);
    nat.battery = s.battery;

    // hull
    if (s.hullHeal > 0) {
      s.hull = Math.min(100, s.hull + s.hullHeal * dt);
      if (s.hull >= 100) s.hullHeal = 0;
    }
    s.kick *= Math.exp(-dt / 3);
    s.hullTemp = ou(s.hullTemp, -10, 0.5, 1, dt, g());
    s.stress = ou(s.stress, 10 + 2 * Math.max(0, s.warp - 8) + s.kick, 0.5, 0.8, dt, g());
    nat.hullIntegrity = s.hull;
    nat.hullTemp = s.hullTemp;
    nat.hullStress = Math.max(0, s.stress);

    // decks
    for (let d = 0; d < DECKS; d++) {
      const n = pad(d + 1);
      s.o2[d] = ou(s.o2[d], 20.9, 0.2, 0.03, dt, g());
      s.co2[d] = ou(s.co2[d], 600, 0.5, 15, dt, g());
      s.temp[d] = ou(s.temp[d], 21.5, 0.5, 0.05, dt, g());
      s.press[d] = ou(s.press[d], 101.3, 0.5, 0.05, dt, g());
      s.grav[d] = ou(s.grav[d], 1, 0.5, 0.002, dt, g());
      nat[`o2_${n}`] = s.o2[d];
      nat[`co2_${n}`] = Math.max(0, s.co2[d]);
      nat[`temp_${n}`] = s.temp[d];
      nat[`press_${n}`] = s.press[d];
      nat[`grav_${n}`] = s.grav[d];
    }

    // sensors
    s.lr = ou(s.lr, 98.5, 0.5, 0.2, dt, g());
    s.sr = ou(s.sr, 98.5, 0.5, 0.2, dt, g());
    s.ion = ou(s.ion, 4, 0.5, 0.3, dt, g());
    s.snr = ou(s.snr, 2, 0.5, 0.3, dt, g());
    s.cBearing = lag(s.cBearing, s.contact.bearing, 2, dt);
    s.cRange = s.contact.n > 0 ? lag(s.cRange, s.contact.range, 2, dt) : 1_000_000;
    nat.lrSensor = Math.min(100, s.lr);
    nat.srSensor = Math.min(100, s.sr);
    nat.contacts = s.contact.n;
    nat.contactBearing = s.cBearing;
    nat.contactRange = s.cRange;
    nat.contactSnr = Math.max(0, s.snr) * (this.t < s.focusUntil ? 2 : 1);
    nat.ionFlux = Math.max(0, s.ion);
    nat.lifeforms = 0;

    // transporter
    const xp = s.xp;
    if (xp.phase) {
      xp.t += dt;
      if (xp.phase === 1 && xp.t >= 1.5) Object.assign(xp, { phase: 2, t: 0 });
      else if (xp.phase === 2 && xp.t >= 3) Object.assign(xp, { phase: 0, t: 0 });
    }
    s.xpe = lag(s.xpe, xp.phase ? 18 : 0, 0.4, dt);
    nat.xpState = xp.phase;
    nat.xpEnergy = xp.phase ? Math.max(0, s.xpe + 0.3 * g()) : s.xpe < 0.05 ? 0 : s.xpe;
    nat.xpLock = 100;
    nat.xpPattern = 100;

    // comms
    s.carrier = ou(s.carrier, 45, 0.5, 0.4, dt, g());
    s.delay = ou(s.delay, 1.2, 0.5, 0.1, dt, g());
    s.loss = ou(s.loss, 0.3, 0.5, 0.1, dt, g());
    s.interf = ou(s.interf, 3, 0.5, 0.3, dt, g());
    nat.carrier = s.carrier;
    nat.delay = Math.max(0, s.delay);
    nat.loss = Math.max(0, s.loss);
    nat.interference = Math.max(0, s.interf);
    nat.channelsOpen = s.channels + (s.hailing ? 1 : 0);
    nat.hailing = s.hailing;

    // crew summary, from the same crew model the sickbay hub streams
    nat.crewAboard = this.crew.aboard;
    nat.crewWatch = this.crew.counts.watch;
    nat.crewCritical = this.crew.counts.critical;
    nat.crewMeanHr = this.crew.counts.meanHr;

    // overrides, extra noise, old-style faults, then the range of every channel
    const out = this.out;
    for (const c of CH) out[c.key] = nat[c.key];
    for (const [key, ov] of this.ov) {
      if (ov.until !== undefined && this.t >= ov.until) this.ov.set(key, { release: true, last: out[key], t0: this.t, over: 2 });
      const k = ov.over > 0 ? Math.min(1, (this.t - ov.t0) / ov.over) : 1;
      if (ov.release) {
        out[key] = ov.last + (out[key] - ov.last) * k;
        if (k >= 1) this.ov.delete(key);
      } else {
        out[key] = ov.from + (ov.to - ov.from) * k;
      }
    }
    for (const [key, n] of this.nz) {
      const fade = n.fadeFrom !== undefined ? 1 - Math.min(1, (this.t - n.fadeFrom) / n.fadeOver) : 1;
      n.x = ou(n.x, 0, NOISE_THETA, n.sigma * Math.sqrt(2 * NOISE_THETA), dt, g());
      out[key] += n.x * fade;
      if (fade === 0) this.nz.delete(key);
    }
    for (const [key, f] of this.faults) out[key] += (f.target - out[key]) * Math.min(1, (ts - f.at) / (f.rampSec * 1000));
    for (const c of CH) out[c.key] = clamp(out[c.key], c.min, c.max);

    // position follows the speed and heading the bridge sees
    const rad = (out.heading * Math.PI) / 180;
    const run = (out.speed / 400) * dt;
    s.posX = clamp(s.posX + Math.sin(rad) * run, -5000, 5000);
    s.posY = clamp(s.posY + Math.cos(rad) * run, -5000, 5000);
    out.posX = s.posX;
    out.posY = s.posY;
    return out;
  }
}
