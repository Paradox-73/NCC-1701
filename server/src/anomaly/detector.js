import { CHANNEL_BY_KEY, GROUP_KIND, RULES, kindOf } from '@ncc/shared/schema.js';

const RANK = { info: 1, warn: 2, critical: 3 };
const Z_LIMIT = 4;
const Z_HOLD_MS = 500;
const Z_REF_MS = 20; // the sample spacing the window constants below were tuned at (50 Hz)
const Z_WARMUP = 1500; // in 50 Hz sample equivalents (30 s), long enough for the variance estimate to settle
const Z_ALPHA = 1 / 500; // per 20 ms of sample time: about a 10 s window at any sample rate
// floor on the standard deviation so a flat signal does not make tiny wiggles look huge
const zFloor = (key) => (CHANNEL_BY_KEY[key].max - CHANNEL_BY_KEY[key].min) * 0.01;

const fmt = (key, v) => {
  const c = CHANNEL_BY_KEY[key];
  return `${c.label} ${Number(v.toFixed(2))}${c.unit ? ' ' + c.unit : ''}`;
};

// Each source kind has its own channels, so each has its own rules: a ship's rules never run on a sickbay sample.
const BY_KIND = { ship: { rules: [], z: [] }, crew: { rules: [], z: [] } };
for (const r of RULES.thresholds) BY_KIND[GROUP_KIND[CHANNEL_BY_KEY[r.channel].group]].rules.push({ ...r, id: `${r.type}:${r.channel}` });
for (const k of RULES.zChannels) BY_KIND[GROUP_KIND[CHANNEL_BY_KEY[k].group]].z.push(k);

/** Which side of the limits a value is on, as a severity or null. */
const severity = (rule, v) => {
  const beyond = (limit) => (rule.dir === 'high' ? v > limit : v < limit);
  return beyond(rule.critical) ? 'critical' : beyond(rule.warn) ? 'warn' : null;
};

/**
 * Rule and statistics based anomaly detection, one state machine per (source, type).
 * An alert opens once when its condition holds and stays open (no duplicates)
 * until the condition has been false for `debounceMs`; a rise in severity
 * emits one more alert. All times are milliseconds from `now()`.
 * Thresholds and the z-score channels come from RULES in shared/registry.js.
 */
export class Detector {
  constructor({ onAlert, now = Date.now, debounceMs = 3000, linkLossMs = 1500, offlineMs = 30000, graceMs = 5000 }) {
    this.onAlert = onAlert;
    this.now = now;
    this.debounceMs = debounceMs;
    this.linkLossMs = linkLossMs;
    this.offlineMs = offlineMs;
    this.graceMs = graceMs; // no link-loss alert until the detector has run, and the source has sent, this long: a server that just started has not heard its sources yet
    this.startedAt = 0; // set by the first tick, which the server starts only when it is ready
    this.conds = new Map(); // "sourceId|type" -> condition state
    this.sources = new Map(); // sourceId -> { lastRx, firstRx, z }
  }

  /** How long a source may stay silent: the configured limit, and at least 3.5 s for a sickbay hub, which sends once a second. */
  _silenceLimit(sourceId) {
    return kindOf(sourceId) === 'crew' ? Math.max(this.linkLossMs, 3500) : this.linkLossMs;
  }

  _source(id) {
    let c = this.sources.get(id);
    if (!c) this.sources.set(id, (c = { lastRx: 0, firstRx: 0, z: {} }));
    return c;
  }

  /** `s` is a decoded sample in real units. */
  push(sourceId, s) {
    const t = this.now();
    const src = this._source(sourceId);
    // a source back after a silence (a restarted simulator or logger) is not compared with its old statistics: learn its values again
    if (src.lastRx && t - src.lastRx > this._silenceLimit(sourceId)) Object.assign(src, { z: {}, zFrom: t + 1000 });
    src.lastRx = t;
    src.firstRx ||= t;

    const kind = BY_KIND[kindOf(sourceId)];
    for (const rule of kind.rules) {
      const v = s[rule.channel];
      const sev = severity(rule, v);
      if (!sev && !this.conds.has(sourceId + '|' + rule.id)) continue; // nothing to open and nothing open to close: skip building the message
      const limit = sev === 'critical' ? rule.critical : rule.warn;
      this._cond(sourceId, rule.id, sev, { type: rule.type, channel: rule.channel, value: v, threshold: limit, message: fmt(rule.channel, v) }, t, 0);
    }

    if (src.zFrom > t) return;
    // weight each sample by the time it stands for, so the window and warm-up are the same at 5 Hz as at 50 Hz
    const zw = src.zTs ? Math.min(50, Math.max(1, (s.ts - src.zTs) / Z_REF_MS)) : 1;
    src.zTs = s.ts;
    for (const key of kind.z) this._z(sourceId, src, key, s[key], t, zw);
  }

  _z(sourceId, src, key, v, t, w) {
    const a = 1 - (1 - Z_ALPHA) ** w;
    let st = src.z[key];
    if (!st) st = src.z[key] = { mean: v, varr: 0, n: 0 };
    const sd = Math.max(Math.sqrt(st.varr), zFloor(key));
    const z = (v - st.mean) / sd;
    // while a settle window runs (the operating point was changed on purpose) nothing is anomalous and the statistics follow the values
    const anomalous = t >= (src.settleUntil ?? 0) && st.n >= Z_WARMUP && Math.abs(z) > Z_LIMIT;
    this._cond(sourceId, 'zscore:' + key, anomalous ? 'warn' : null, { type: 'zscore', channel: key, value: v, threshold: Z_LIMIT, message: `${CHANNEL_BY_KEY[key].label} is ${Math.abs(z).toFixed(1)} standard deviations ${z < 0 ? 'below' : 'above'} its recent mean` }, t, Z_HOLD_MS);
    if (!anomalous) {
      // statistics are frozen during an anomaly so it cannot become the new normal
      const d = v - st.mean;
      st.mean += a * d;
      st.varr = (1 - a) * (st.varr + a * d * d);
      st.n += w;
    }
  }

  /** Call every ~250 ms: link-loss rule and closing of conditions on silent sources. */
  tick() {
    const t = this.now();
    this.startedAt ||= t;
    for (const [sourceId, src] of this.sources) {
      if (!src.lastRx) continue;
      const silent = t - src.lastRx;
      if (silent > this.offlineMs) {
        // source went away: close everything for it and stop watching
        for (const key of [...this.conds.keys()]) if (key.startsWith(sourceId + '|')) this.conds.delete(key);
        this.sources.delete(sourceId);
        continue;
      }
      const settled = t - this.startedAt >= this.graceMs && t - src.firstRx >= this.graceMs;
      this._cond(sourceId, 'link-loss', settled && silent > this._silenceLimit(sourceId) ? 'warn' : null, { type: 'link-loss', channel: 'samples', value: silent / 1000, threshold: this._silenceLimit(sourceId) / 1000, message: `No samples for ${(silent / 1000).toFixed(1)} s` }, t, 0);
    }
  }

  /**
   * The operating point of a source is about to change on purpose (a new warp order, a scenario restoring normal
   * running): for `ms` its statistics follow the values instead of flagging them, and keep their warm-up.
   */
  settle(sourceId, ms = 20_000) {
    const src = this.sources.get(sourceId);
    if (src) src.settleUntil = this.now() + ms;
  }

  /**
   * A repaired source (the clear command) starts from a new normal: statistics are learned again, so the jump back to
   * normal is not read as an anomaly. Without this, statistics frozen during a long fault never accept the repaired
   * value and a z-score warning stays open. Open alerts close as usual.
   */
  reset(sourceId) {
    const src = this.sources.get(sourceId);
    if (src) Object.assign(src, { z: {}, zFrom: this.now() + 1000 });
  }

  /**
   * An alert condition raised by something other than a channel rule (the server's ingest counters): same open,
   * escalate and debounce behaviour as a threshold. `sev` is 'warn', 'critical' or null for clear.
   */
  condition(sourceId, type, sev, info, holdMs = 0) {
    this._cond(sourceId, type, sev, { type, channel: info.channel ?? 'ingest', ...info }, this.now(), holdMs);
  }

  /** 0 none, 1 info, 2 warn, 3 critical: worst open alert for a source. */
  openSeverity(sourceId) {
    let m = 0;
    for (const [k, c] of this.conds) if (c.open && k.startsWith(sourceId + '|')) m = Math.max(m, RANK[c.sev]);
    return m;
  }

  _cond(sourceId, key, sev, info, t, holdMs) {
    const id = sourceId + '|' + key;
    let c = this.conds.get(id);
    if (!c) {
      if (!sev) return;
      this.conds.set(id, (c = { since: 0, lastTrue: 0, open: false, sev: null }));
    }
    if (sev) {
      c.since ||= t;
      c.lastTrue = t;
      if (t - c.since < holdMs) return;
      if (!c.open || RANK[sev] > RANK[c.sev]) {
        c.open = true;
        c.sev = sev;
        this.onAlert({ sourceId, ts: t, group: CHANNEL_BY_KEY[info.channel]?.group ?? null, severity: sev, ...info });
      }
    } else {
      c.since = 0;
      if (c.open && t - c.lastTrue >= this.debounceMs) {
        c.open = false;
        c.sev = null;
      }
    }
  }
}
