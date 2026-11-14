// One source link to the server: a Socket.IO client of /ingest that sends a batch every BATCH_MS (50 ms default),
// keeps at most 4 batches un-acked, pauses on credit 0, and resends un-acked batches after a reconnect.
// The simulator and the load test both use it, so they follow the same protocol rules.
import { io } from 'socket.io-client';
import parser from 'socket.io-msgpack-parser';
import { EVENTS } from '@ncc/shared/schema.js';

const MAX_IN_FLIGHT = 4;
// Shorter batches cut latency (a sample waits at most one batch period); env SIM_BATCH_MS overrides.
const BATCH_MS = Number(process.env.SIM_BATCH_MS) || 50;
const ACK_TIMEOUT_MS = 3000;
const PROBE_MS = 300;
// After a long outage the backlog is cut into batches this size: up to MAX_IN_FLIGHT of them plus a resent tail must stay
// inside the server's reorder window (LIMITS.reorderWindow, 256 samples), or the resent samples count as stale.
const BATCH_SAMPLES = 50;
// Pause after the server throttled or refused samples, so its own limits pace the backlog instead of a tight resend loop.
const THROTTLE_HOLD_MS = 100;

export class Sender {
  // hooks: { onAck(ack, rttMs, sampleCount), onCommand(cmd), onState(text) }
  constructor({ url, sourceId, key, hooks = {}, maxQueueSamples = 3000 }) {
    this.sourceId = sourceId;
    this.hooks = hooks;
    this.maxQueueSamples = maxQueueSamples;
    this.pending = []; // samples not yet cut into a batch
    this.queue = []; // batches waiting to be sent: { id, samples }
    this.inflight = new Map(); // id -> { batch, sentAt }
    this.nextId = 1;
    this.credit = 1;
    this.probeAt = 0;
    this.holdUntil = 0;
    this.closed = false;
    this.stats = { sentSamples: 0, ackedSamples: 0, batches: 0, accepted: 0, duplicates: 0, stale: 0, invalid: 0, throttled: 0, dropped: 0, reconnects: 0, timeouts: 0, notOk: 0 };

    this.socket = io(`${url.replace(/\/$/, '')}/ingest`, {
      parser,
      transports: ['websocket'],
      auth: { sourceId, key },
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
    });
    this.socket.on('connect', () => {
      this.hooks.onState?.('connected');
      this.#requeueInflight(); // anything sent on the old connection is resent; the server de-duplicates by seq
      this.#pump();
    });
    this.socket.on('disconnect', (reason) => {
      if (!this.closed) this.stats.reconnects++;
      this.hooks.onState?.(`disconnected (${reason})`);
      this.#requeueInflight();
      // the server closed us (for example a newer connection took over): socket.io will not retry by itself
      if (reason === 'io server disconnect' && !this.closed) setTimeout(() => !this.closed && this.socket.connect(), 1000 + Math.random() * 1000);
    });
    this.socket.on('connect_error', (err) => this.hooks.onState?.(`connect error: ${err.message}`));
    this.socket.on(EVENTS.COMMAND, (cmd) => this.hooks.onCommand?.(cmd));
    this.timer = setInterval(() => this.#cut(), BATCH_MS);
  }

  get connected() {
    return this.socket.connected;
  }

  push(samples) {
    for (const s of samples) this.pending.push(s);
  }

  #cut() {
    if (this.pending.length) {
      for (let i = 0; i < this.pending.length; i += BATCH_SAMPLES) {
        this.queue.push({ id: this.nextId++, samples: this.pending.slice(i, i + BATCH_SAMPLES) });
      }
      this.pending = [];
    }
    let total = this.queue.reduce((n, b) => n + b.samples.length, 0);
    while (total > this.maxQueueSamples && this.queue.length > 1) {
      const old = this.queue.shift();
      total -= old.samples.length;
      this.stats.dropped += old.samples.length; // link down or server slow for too long: oldest data is lost
    }
    this.#pump();
  }

  #requeueInflight() {
    const back = [...this.inflight.values()].map((e) => e.batch);
    this.inflight.clear();
    this.queue = [...back, ...this.queue].sort((a, b) => a.id - b.id);
  }

  #canSend() {
    if (!this.socket.connected || this.inflight.size >= MAX_IN_FLIGHT || Date.now() < this.holdUntil) return false;
    if (this.credit > 0) return true;
    // credit 0: wait for acks of what is in flight; with nothing in flight, probe so we cannot stall forever
    return this.inflight.size === 0 && Date.now() >= this.probeAt;
  }

  #pump() {
    while (this.queue.length && this.#canSend()) {
      const batch = this.queue.shift();
      const entry = { batch, sentAt: performance.now() };
      this.inflight.set(batch.id, entry);
      this.stats.batches++;
      this.stats.sentSamples += batch.samples.length;
      this.socket.timeout(ACK_TIMEOUT_MS).emit(EVENTS.BATCH, { sourceId: this.sourceId, samples: batch.samples }, (err, ack) => {
        if (this.inflight.get(batch.id) !== entry) return; // already requeued after a disconnect
        this.inflight.delete(batch.id);
        if (err) {
          this.stats.timeouts++;
          this.queue.unshift(batch);
          this.queue.sort((a, b) => a.id - b.id);
          return this.#pump();
        }
        const rtt = performance.now() - entry.sentAt;
        const st = this.stats;
        if (ack?.ok) st.ackedSamples += batch.samples.length - (ack.throttled ?? 0);
        else st.notOk++;
        st.accepted += ack?.accepted ?? 0;
        st.duplicates += ack?.duplicates ?? 0;
        st.stale += ack?.stale ?? 0;
        st.invalid += ack?.invalid ?? 0;
        st.throttled += ack?.throttled ?? 0;
        this.credit = ack?.credit ?? 1;
        // The server keeps the first samples of a batch and drops the last `throttled` ones; a refused batch (rate limit, ok false
        // with nothing accepted) is dropped whole. Neither is lost: put them back at the front and send them again.
        // A batch refused as invalid is not resent, because it would be refused again.
        const again = ack?.throttled > 0 ? (ack.ok ? batch.samples.slice(-ack.throttled) : batch.samples) : null;
        if (again) {
          this.queue.unshift({ id: batch.id, samples: again });
          this.holdUntil = Date.now() + THROTTLE_HOLD_MS;
        }
        if (this.credit <= 0) this.probeAt = Date.now() + PROBE_MS;
        this.hooks.onAck?.(ack, rtt, batch.samples.length);
        this.#pump();
      });
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.socket.close();
  }
}
