/** Refills `rate` tokens per second up to `burst`; take(n) grants as many as are left. */
export class TokenBucket {
  constructor(rate, burst, now = Date.now) {
    this.rate = rate;
    this.burst = burst;
    this.now = now;
    this.tokens = burst;
    this.last = now();
  }

  take(n = 1) {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    const granted = Math.min(n, Math.floor(this.tokens));
    this.tokens -= granted;
    return granted;
  }
}
