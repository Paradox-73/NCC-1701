import { CHANNEL_INDEX, EVENTS, GROUPS, GROUP_CHANNELS } from '@ncc/shared/schema.js';

const IDX = Object.fromEntries(GROUPS.map((g) => [g, GROUP_CHANNELS[g].map((k) => CHANNEL_INDEX[k])]));

/**
 * Owns the frame loop (FRAME_MS), the 200 ms overview and the 1 Hz metrics emit.
 * Accepted samples are queued per source; each tick sends, for every room that has
 * listeners, only that group's columns of only the samples that are new.
 */
export class Broadcaster {
  constructor({ io, config, metrics, states, detector }) {
    this.nsp = io.of('/live');
    this.config = config;
    this.metrics = metrics;
    this.states = states;
    this.detector = detector;
    this.pending = new Map(); // sourceId -> packed samples since the last tick
    this.rxCount = 0; // samples accepted since the last metrics tick
    this.rxRate = 0; // samples accepted per second, over the last metrics tick
    this.timers = [];
  }

  enqueue(sourceId, packed) {
    let q = this.pending.get(sourceId);
    if (!q) this.pending.set(sourceId, (q = []));
    q.push(packed);
    this.rxCount++;
  }

  start() {
    const every = (ms, fn) => this.timers.push(setInterval(fn, ms).unref());
    every(this.config.frameMs, () => this.sendFrames());
    every(this.config.overviewMs, () => this.sendOverview());
    every(this.config.metricsMs, () => this.sendMetrics());
  }

  stop() {
    this.timers.forEach(clearInterval);
  }

  sendFrames() {
    const rooms = this.nsp.adapter.rooms;
    const now = Date.now();
    for (const [sourceId, q] of this.pending) {
      this.pending.delete(sourceId);
      q.sort((a, b) => a[0] - b[0]);
      let emitted = false;
      for (const group of GROUPS) {
        const room = `src:${sourceId}:${group}`;
        const listeners = rooms.get(room)?.size;
        if (!listeners) continue;
        const idx = IDX[group];
        const samples = q.map((s) => [s[0], s[1], ...idx.map((i) => s[i])]);
        this.nsp.to(room).emit(EVENTS.FRAME, { sourceId, group, keys: GROUP_CHANNELS[group], samples });
        this.metrics.inc('framesOut');
        this.metrics.inc('framesDelivered', listeners);
        emitted = true;
      }
      if (emitted) for (const s of q) this.metrics.observeLatency(now - s[1]);
    }
  }

  /** Volatile: a slow client drops this instead of queueing it. One row per active source: [sourceId, flags]. */
  sendOverview() {
    if (!this.nsp.adapter.rooms.get('overview')?.size) return;
    const sources = [];
    for (const c of this.states.sources.values()) {
      if (!this.states.isActive(c)) continue;
      const sev = this.detector.openSeverity(c.sourceId);
      sources.push([c.sourceId, 1 | (sev >= 2 ? 2 : 0) | (sev >= 3 ? 4 : 0)]);
    }
    this.nsp.to('overview').volatile.emit(EVENTS.OVERVIEW, { ts: Date.now(), sources, rx: this.rxRate });
  }

  sendMetrics() {
    this.rxRate = Math.round(this.rxCount * (1000 / this.config.metricsMs));
    this.rxCount = 0;
    this.metrics.tick();
    if (this.nsp.adapter.rooms.get('admin')?.size) this.nsp.to('admin').emit(EVENTS.METRICS, this.metrics.snapshot());
  }
}
