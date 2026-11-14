// Alerts from the server's own ingest counters: what a source gets refused, rejected or throttled for. They go
// through the detector's open, escalate and debounce rules, so they look like every other alert.
const BUCKET_MS = 250;
const WINDOW_MS = 2000;
const N = WINDOW_MS / BUCKET_MS;

export const INGEST_LIMITS = { refusedHandshakes: 3, invalidPerSec: 20, throttledPerSec: 200 };

export class IngestWatch {
  constructor({ detector, now = Date.now }) {
    this.detector = detector;
    this.now = now;
    this.sources = new Map(); // sourceId -> ring of N buckets { refused, invalid, throttled } and the bucket index they belong to
  }

  _ring(sourceId) {
    let r = this.sources.get(sourceId);
    if (!r) this.sources.set(sourceId, (r = { slot: 0, b: Array.from({ length: N }, () => ({ refused: 0, invalid: 0, throttled: 0 })) }));
    return r;
  }

  _advance(r) {
    const slot = Math.floor(this.now() / BUCKET_MS);
    for (let s = r.slot + 1; s <= slot && s <= r.slot + N; s++) r.b[s % N] = { refused: 0, invalid: 0, throttled: 0 };
    r.slot = slot;
    return r.b[slot % N];
  }

  /** Adds counts for a source: { refused, invalid, throttled }. */
  note(sourceId, counts) {
    const cur = this._advance(this._ring(sourceId));
    for (const k of ['refused', 'invalid', 'throttled']) cur[k] += counts[k] ?? 0;
  }

  /** Call every ~250 ms: opens, escalates or clears the three ingest conditions of every source seen. */
  tick() {
    for (const [sourceId, r] of this.sources) {
      this._advance(r);
      const sum = { refused: 0, invalid: 0, throttled: 0 };
      for (const b of r.b) for (const k in sum) sum[k] += b[k];
      const per = (n) => n / (WINDOW_MS / 1000);
      const c = (type, sev, value, threshold, message) => this.detector.condition(sourceId, type, sev, { value, threshold, message });
      c('ingest-auth', sum.refused >= INGEST_LIMITS.refusedHandshakes ? 'warn' : null, sum.refused, INGEST_LIMITS.refusedHandshakes, `${sum.refused} refused /ingest handshakes in 2 s (wrong device key)`);
      c('ingest-invalid', per(sum.invalid) > INGEST_LIMITS.invalidPerSec ? 'warn' : null, per(sum.invalid), INGEST_LIMITS.invalidPerSec, `${per(sum.invalid).toFixed(0)} invalid samples a second refused`);
      c('ingest-flood', per(sum.throttled) > INGEST_LIMITS.throttledPerSec ? 'critical' : null, per(sum.throttled), INGEST_LIMITS.throttledPerSec, `${per(sum.throttled).toFixed(0)} samples a second throttled`);
    }
  }
}
