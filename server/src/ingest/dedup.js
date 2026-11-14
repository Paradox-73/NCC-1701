export const OK = 0;
export const DUPLICATE = 1;
export const STALE = 2;

/**
 * Remembers the newest sequence number and a bitset of the last `size` ones.
 * check() classifies a seq as new/late (OK), already seen (DUPLICATE) or
 * older than the window (STALE), and records it when it is OK.
 */
export class SeqWindow {
  constructor(size = 256) {
    this.size = size;
    this.bits = new Uint8Array(size);
    this.max = 0;
  }

  check(seq) {
    const { size, bits } = this;
    if (seq > this.max) {
      // clear the slots the window slides over, then mark the new newest seq
      const gap = Math.min(seq - this.max, size);
      for (let i = 1; i <= gap; i++) bits[(this.max + i) % size] = 0;
      this.max = seq;
      bits[seq % size] = 1;
      return OK;
    }
    if (seq <= this.max - size) return STALE;
    if (bits[seq % size]) return DUPLICATE;
    bits[seq % size] = 1;
    return OK;
  }

  /** After a restart: everything up to lastSeq counts as seen. */
  restore(lastSeq) {
    this.max = lastSeq;
    this.bits.fill(1);
  }

  reset() {
    this.max = 0;
    this.bits.fill(0);
  }
}
