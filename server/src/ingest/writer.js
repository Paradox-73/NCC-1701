/**
 * Batches documents and writes them with insertMany({ ordered: false }) every
 * `flushMs` or as soon as `flushSamples` are queued. `backpressured` turns true
 * above `highWater` queued documents and is what makes acks carry credit 0.
 */
export class Writer {
  constructor({ getCollection, flushMs, flushSamples, highWater, log, onFlush = () => {} }) {
    this.getCollection = getCollection;
    this.flushSamples = flushSamples;
    this.highWater = highWater;
    this.log = log;
    this.onFlush = onFlush;
    this.queue = [];
    this.writing = []; // the batch insertMany is writing now
    this.flushing = null;
    this.backpressureMs = 0;
    this.bpSince = 0;
    this.written = 0;
    this.failed = 0;
    this.lastFlush = { size: 0, ms: 0 };
    this.timer = setInterval(() => this.flush(), flushMs);
    this.timer.unref();
  }

  get depth() {
    return this.queue.length;
  }

  get backpressured() {
    return this.queue.length >= this.highWater;
  }

  add(docs) {
    for (const d of docs) this.queue.push(d);
    this._trackBackpressure();
    if (this.queue.length >= this.flushSamples) this.flush();
  }

  _trackBackpressure() {
    const now = Date.now();
    if (this.backpressured) this.bpSince ||= now;
    else if (this.bpSince) {
      this.backpressureMs += now - this.bpSince;
      this.bpSince = 0;
    }
  }

  /** Total milliseconds spent in backpressure, including a period still running. */
  get backpressureTotalMs() {
    return this.backpressureMs + (this.bpSince ? Date.now() - this.bpSince : 0);
  }

  flush() {
    if (this.flushing) return this.flushing;
    if (!this.queue.length) return Promise.resolve();
    const batch = this.queue.splice(0, this.flushSamples);
    this.writing = batch;
    const t0 = performance.now();
    this.flushing = this.getCollection()
      .insertMany(batch, { ordered: false })
      .then(() => {
        this.written += batch.length;
      })
      .catch((err) => {
        // shortcut: failed batches are dropped and counted, not retried
        const n = err.result?.insertedCount ?? 0;
        this.written += n;
        this.failed += batch.length - n;
        this.log.error({ err: err.message, dropped: batch.length - n }, 'telemetry write failed');
      })
      .finally(() => {
        this.writing = [];
        this.lastFlush = { size: batch.length, ms: performance.now() - t0 };
        this.onFlush(this.lastFlush);
        this.flushing = null;
        this._trackBackpressure();
        if (this.queue.length >= this.flushSamples) this.flush();
      });
    return this.flushing;
  }

  /** Accepted documents MongoDB may not hold yet: the batch being written plus the queue. */
  unwritten() {
    return this.writing.concat(this.queue);
  }

  /** Writes everything still queued; used on shutdown and in tests. */
  async drain() {
    while (this.queue.length || this.flushing) await this.flush();
  }

  stop() {
    clearInterval(this.timer);
    return this.drain();
  }
}
