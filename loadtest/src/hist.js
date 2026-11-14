// Fixed-size latency histogram: 1 ms buckets up to 30 s, so memory stays constant however many samples arrive.
// Histograms from several worker threads merge by adding bucket counts.
const BUCKETS = 30001;

export class Hist {
  constructor(counts) {
    this.counts = counts ?? new Uint32Array(BUCKETS);
    this.n = 0;
    this.max = 0;
    this.sum = 0;
  }

  add(ms) {
    if (!(ms >= 0)) ms = 0; // a sample stamped slightly in the future (clock jitter) counts as 0
    this.counts[Math.min(BUCKETS - 1, Math.floor(ms))]++;
    this.n++;
    this.sum += ms;
    if (ms > this.max) this.max = ms;
  }

  // plain object that can cross a worker boundary
  toJSON() {
    return { counts: this.counts, n: this.n, max: this.max, sum: this.sum };
  }

  static merge(list) {
    const h = new Hist();
    for (const o of list) {
      for (let i = 0; i < BUCKETS; i++) h.counts[i] += o.counts[i];
      h.n += o.n;
      h.sum += o.sum;
      h.max = Math.max(h.max, o.max);
    }
    return h;
  }

  percentile(p) {
    if (!this.n) return null;
    const target = Math.ceil((p / 100) * this.n);
    let acc = 0;
    for (let i = 0; i < BUCKETS; i++) {
      acc += this.counts[i];
      if (acc >= target) return i + 1; // upper edge of the 1 ms bucket
    }
    return this.max;
  }

  summary() {
    return { count: this.n, mean: this.n ? +(this.sum / this.n).toFixed(1) : null, p50: this.percentile(50), p95: this.percentile(95), p99: this.percentile(99), max: +this.max.toFixed(1) };
  }
}
