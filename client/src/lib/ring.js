// Fixed-size ring buffer of samples in typed arrays, one column per channel key. No dependencies, so it runs
// in the browser and under node --test.
// Old samples are overwritten once cap is reached. 4096 slots hold 6.8 minutes at 10 Hz.
export class Ring {
  constructor(keys, cap = 4096) {
    this.keys = keys;
    this.cap = cap;
    this.seq = new Float64Array(cap);
    this.ts = new Float64Array(cap);
    this.cols = Object.fromEntries(keys.map((k) => [k, new Float64Array(cap)]));
    this.head = 0; // next slot to write
    this.len = 0;
    this.lastSeq = 0;
  }

  // rows are [seq, ts, ...values for this.keys]; returns false when the sample was already drawn
  push(row) {
    if (row[0] <= this.lastSeq) return false;
    const h = this.head;
    this.seq[h] = row[0];
    this.ts[h] = row[1];
    for (let i = 0; i < this.keys.length; i++) this.cols[this.keys[i]][h] = row[i + 2];
    this.lastSeq = row[0];
    this.head = (h + 1) % this.cap;
    if (this.len < this.cap) this.len++;
    return true;
  }

  // oldest-first rows (same shape as push) with seq above `after`
  rows(after = 0) {
    const out = [];
    for (let i = 0; i < this.len; i++) {
      const idx = (this.head - this.len + i + this.cap * 2) % this.cap;
      if (this.seq[idx] > after) out.push([this.seq[idx], this.ts[idx], ...this.keys.map((k) => this.cols[k][idx])]);
    }
    return out;
  }

  reset() { this.head = 0; this.len = 0; this.lastSeq = 0; }

  // Adds rows that may be older than lastSeq (push only appends): rebuilds the buffer in seq order,
  // each seq once. Returns how many rows were new.
  merge(rows) {
    const bySeq = new Map(this.rows().map((r) => [r[0], r]));
    const before = bySeq.size;
    for (const r of rows) if (!bySeq.has(r[0])) bySeq.set(r[0], r);
    this.reset();
    for (const r of [...bySeq.values()].sort((a, b) => a[0] - b[0])) this.push(r);
    return bySeq.size - before;
  }

  get lastTs() { return this.len ? this.ts[(this.head - 1 + this.cap) % this.cap] : 0; }
  last(key) { return this.len ? this.cols[key][(this.head - 1 + this.cap) % this.cap] : undefined; }

  // Oldest-first copy of the newest `ms` milliseconds: [xSeconds, ...columns for keys]
  window(ms, keys) {
    if (!this.len) return null;
    const end = this.lastTs;
    let n = 0;
    while (n < this.len && end - this.ts[(this.head - 1 - n + this.cap * 2) % this.cap] <= ms) n++;
    const xs = new Array(n);
    const out = keys.map(() => new Array(n));
    for (let i = 0; i < n; i++) {
      const idx = (this.head - n + i + this.cap * 2) % this.cap;
      xs[i] = this.ts[idx] / 1000;
      keys.forEach((k, j) => { out[j][i] = this.cols[k][idx]; });
    }
    return [xs, ...out];
  }
}
