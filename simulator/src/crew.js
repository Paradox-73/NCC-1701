// The crew of one ship: 430 people with four vitals each, one personal baseline each, drawn once from a seeded
// generator so the same ship always has the same crew. Vitals follow an Ornstein-Uhlenbeck process (noise that pulls
// back toward a mean) around the baseline plus whatever effect a scenario has put on that person: an infection, a
// sedative, a shift. Run at 1 Hz; the crew hub sends the vitals and the ship's `crewsummary` channels count them.
import { CREW_SIZE, RULES, deckOfCrew, pad } from '@ncc/shared/schema.js';

const VITALS = ['hr', 'rr', 'bt', 'nr'];
const THETA = 0.5;
const SIGMA = { hr: 1.5, rr: 0.3, bt: 0.02, nr: 1 };
const RULE_LIMITS = {};
for (const r of RULES.thresholds) {
  const m = /^(hr|rr|bt|nr)_001$/.exec(r.channel);
  if (m) (RULE_LIMITS[m[1]] ??= []).push(r);
}

export const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export class CrewModel {
  constructor(shipId, { rand = Math.random } = {}) {
    this.rand = rand;
    const seeded = mulberry32(shipId * 7919 + 17);
    const n = CREW_SIZE + 1; // index 1..430
    this.base = { hr: new Float64Array(n), rr: new Float64Array(n), bt: new Float64Array(n), nr: new Float64Array(n).fill(100) };
    this.x = { hr: new Float64Array(n), rr: new Float64Array(n), bt: new Float64Array(n), nr: new Float64Array(n) };
    this.delta = { hr: new Float64Array(n), rr: new Float64Array(n), bt: new Float64Array(n), nr: new Float64Array(n) }; // effect at full weight
    this.w = new Float64Array(n); // weight of the effect: 0 none, 1 full
    this.dw = new Float64Array(n); // change of w per second
    this.kind = new Array(n).fill(null); // 'infected', 'shift' or null
    this.quarantined = new Set();
    this.spread = null; // { every, sinceSec }
    this.aboard = CREW_SIZE;
    for (let i = 1; i < n; i++) {
      this.base.hr[i] = 55 + 30 * seeded();
      this.base.rr[i] = 12 + 6 * seeded();
      this.base.bt[i] = 36.5 + 0.7 * seeded();
      for (const v of VITALS) this.x[v][i] = this.base[v][i];
    }
    this.counts = { watch: 0, critical: 0, meanHr: 0 };
    this.#count();
  }

  #gauss() {
    return Math.sqrt(-2 * Math.log(1 - this.rand())) * Math.cos(2 * Math.PI * this.rand());
  }

  /** Advances `dt` seconds (the hub samples at 1 Hz, so dt is about 1). */
  step(dt) {
    const e = Math.exp(-THETA * dt);
    for (let i = 1; i <= CREW_SIZE; i++) {
      if (this.dw[i]) {
        this.w[i] = Math.min(1, Math.max(0, this.w[i] + this.dw[i] * dt));
        if (this.w[i] === 0 || this.w[i] === 1) {
          if (this.w[i] === 0) this.kind[i] = null;
          this.dw[i] = 0;
        }
      }
      for (const v of VITALS) {
        const mu = this.base[v][i] + this.delta[v][i] * this.w[i];
        this.x[v][i] = mu + (this.x[v][i] - mu) * e + SIGMA[v] * Math.sqrt((1 - e * e) / (2 * THETA)) * this.#gauss();
      }
    }
    if (this.spread && (this.spread.sinceSec += dt) >= this.spread.every) {
      this.spread.sinceSec = 0;
      this.#spreadOnce();
    }
    this.#count();
  }

  #infectedList() {
    const out = [];
    for (let i = 1; i <= CREW_SIZE; i++) if (this.kind[i] === 'infected' && this.w[i] > 0.5) out.push(i);
    return out;
  }

  #spreadOnce() {
    let count = this.kind.filter((k) => k === 'infected').length;
    for (const i of this.#infectedList()) {
      if (count >= this.spread.max) return;
      if (this.quarantined.has(deckOfCrew(i))) continue;
      const times = this.rand() < 0.5 ? 1 : 2;
      for (let k = 0; k < times; k++) {
        const deck = this.rand() < 0.8 ? deckOfCrew(i) : Math.min(12, Math.max(1, deckOfCrew(i) + (this.rand() < 0.5 ? -1 : 1)));
        this.#infectOnDeck(deck);
        count++;
      }
    }
  }

  #infectOnDeck(deck) {
    const first = deck === 1 ? 1 : 13 + (deck - 2) * 38;
    const size = deck === 1 ? 12 : 38;
    for (let tries = 0; tries < 12; tries++) {
      const n = first + Math.floor(this.rand() * size);
      if (this.kind[n] === null) return this.infect(n);
    }
  }

  /** Crew member n falls ill: heart rate, respiration, temperature and neural activity climb over about 3 s. */
  infect(n) {
    if (n < 1 || n > CREW_SIZE || this.kind[n] === 'infected') return;
    const r = this.rand;
    this.delta.hr[n] = 30 + 20 * r();
    this.delta.rr[n] = 5 + 5 * r();
    this.delta.bt[n] = 1 + 0.5 * r();
    this.delta.nr[n] = 50 + 30 * r();
    this.kind[n] = 'infected';
    this.dw[n] = 1 / 3;
  }

  /** `ids` recover over `over` seconds; 'all' means everyone with an effect, { deck } one deck. */
  recover(who, over = 20, onlyKind = null) {
    for (const n of this.#pick(who)) if (this.kind[n] && (!onlyKind || this.kind[n] === onlyKind)) this.dw[n] = -1 / over;
  }

  #pick(who) {
    if (who === 'all' || who === undefined) return Array.from({ length: CREW_SIZE }, (_, i) => i + 1);
    if (Array.isArray(who)) return who;
    if (who.from) return Array.from({ length: who.to - who.from + 1 }, (_, i) => who.from + i);
    if (who.deck) return Array.from({ length: CREW_SIZE }, (_, i) => i + 1).filter((n) => deckOfCrew(n) === who.deck);
    return [];
  }

  /** Adds `d` ({ hr, rr, bt, nr }) to the vitals of the crew members for the next 2 s of settling, until recovered. */
  shift(ids, d) {
    for (const n of this.#pick(ids)) {
      for (const v of VITALS) this.delta[v][n] = d[v] ?? 0;
      this.kind[n] = 'shift';
      this.dw[n] = 1 / 2;
    }
  }

  /** Sets the vitals' targets of the crew members to absolute values (a sedative sets hr 55, nr 50). */
  setTargets(ids, t, kind = 'shift') {
    for (const n of this.#pick(ids)) {
      for (const v of VITALS) this.delta[v][n] = (t[v] ?? this.base[v][n]) - this.base[v][n];
      this.kind[n] = kind;
      this.dw[n] = 1 / 2;
    }
  }

  quarantine(deck) {
    this.quarantined.add(deck);
  }

  /** Every `every` seconds each infected person infects one or two more, until `max` people are infected. */
  startSpread({ every = 8, max = CREW_SIZE } = {}) {
    this.spread = { every, max, sinceSec: 0 };
  }

  stopSpread() {
    this.spread = null;
  }

  /** Everyone back to baseline over `over` seconds, spreading stopped, no quarantine. */
  reset(over = 10) {
    this.spread = null;
    this.quarantined.clear();
    this.recover('all', over);
    this.aboard = CREW_SIZE;
  }

  #count() {
    let watch = 0;
    let critical = 0;
    let hr = 0;
    for (let i = 1; i <= CREW_SIZE; i++) {
      let w = false;
      let c = false;
      for (const v of VITALS) {
        const x = this.x[v][i];
        for (const r of RULE_LIMITS[v]) {
          const beyond = (lim) => (r.dir === 'high' ? x > lim : x < lim);
          if (beyond(r.warn)) w = true;
          if (beyond(r.critical)) c = true;
        }
      }
      if (w) watch++;
      if (c) critical++;
      hr += this.x.hr[i];
    }
    this.counts = { watch, critical, meanHr: hr / CREW_SIZE };
  }

  /** Vitals as an object keyed by channel, for packSample on a crew source. */
  values(out = {}) {
    for (let i = 1; i <= CREW_SIZE; i++) for (const v of VITALS) out[`${v}_${pad(i, 3)}`] = this.x[v][i];
    return out;
  }
}
