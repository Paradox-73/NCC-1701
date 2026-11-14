const ACTIVE_MS = 5000;

/** Latest decoded sample and sequence bookkeeping for every source seen. */
export class SourceStates {
  constructor() {
    this.sources = new Map();
  }

  /** Applies an in-order sample; returns false (and ignores it) when it is older than the current state. */
  update(sourceId, s, packed) {
    let c = this.sources.get(sourceId);
    if (!c) this.sources.set(sourceId, (c = { sourceId, seq: 0, ts: 0, rxAt: 0, v: null, p: null }));
    if (s.seq <= c.seq) return false;
    Object.assign(c, { seq: s.seq, ts: s.ts, rxAt: Date.now(), v: s, p: packed });
    return true;
  }

  /** Forgets a source's live state: its sequence numbers start over, so old ones must not block new samples. */
  reset(sourceId) {
    this.sources.delete(sourceId);
  }

  isActive(c, now = Date.now()) {
    return c.v && now - c.rxAt < ACTIVE_MS;
  }

  get activeCount() {
    const now = Date.now();
    let n = 0;
    for (const c of this.sources.values()) if (this.isActive(c, now)) n++;
    return n;
  }
}
