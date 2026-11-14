import { monitorEventLoopDelay } from 'node:perf_hooks';

const COUNTERS = ['received', 'accepted', 'duplicates', 'stale', 'invalid', 'throttled', 'framesOut', 'framesDelivered', 'bytesOut', 'alerts', 'batches'];
const LAT_SIZE = 8192;

/** Counters with per-second rates, ingest-to-emit latency percentiles and event-loop lag. */
export class Metrics {
  constructor() {
    this.totals = Object.fromEntries(COUNTERS.map((c) => [c, 0]));
    this.prev = { ...this.totals };
    this.rates = { ...this.totals };
    this.lat = new Float64Array(LAT_SIZE);
    this.latN = 0;
    this.lag = monitorEventLoopDelay({ resolution: 10 });
    this.lag.enable();
    this.lagSnap = { mean: 0, p99: 0, max: 0 };
    this.gauges = () => ({});
    this.startedAt = Date.now();
    this.lastTick = Date.now();
  }

  inc(name, n = 1) {
    this.totals[name] += n;
  }

  /** Records one source-timestamp-to-frame-emit latency in milliseconds. */
  observeLatency(ms) {
    this.lat[this.latN++ % LAT_SIZE] = ms;
  }

  /** Call once per second: turns counter deltas into rates and snapshots event-loop lag. */
  tick() {
    const now = Date.now();
    const dt = Math.max((now - this.lastTick) / 1000, 0.001);
    for (const c of COUNTERS) this.rates[c] = Math.round(((this.totals[c] - this.prev[c]) / dt) * 10) / 10;
    this.prev = { ...this.totals };
    this.lastTick = now;
    this.lagSnap = { mean: this.lag.mean / 1e6 || 0, p99: this.lag.percentile(99) / 1e6, max: this.lag.max / 1e6 };
    this.lag.reset();
  }

  latency() {
    const n = Math.min(this.latN, LAT_SIZE);
    if (!n) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const a = this.lat.slice(0, n).sort();
    const q = (p) => Math.round(a[Math.min(n - 1, Math.floor(p * n))] * 10) / 10;
    return { p50: q(0.5), p95: q(0.95), p99: q(0.99), count: this.latN };
  }

  snapshot() {
    const mem = process.memoryUsage();
    const r1 = (x) => Math.round(x * 100) / 100;
    return {
      ts: Date.now(),
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      rates: this.rates,
      totals: { ...this.totals },
      gauges: this.gauges(),
      latencyMs: this.latency(),
      eventLoopLagMs: { mean: r1(this.lagSnap.mean), p99: r1(this.lagSnap.p99), max: r1(this.lagSnap.max) },
      memory: { rssMB: Math.round(mem.rss / 1048576), heapUsedMB: Math.round(mem.heapUsed / 1048576) },
    };
  }

  stop() {
    this.lag.disable();
  }
}
