import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { EVENTS, KINDS, LIMITS, channelsOf, checkPacked, kindOf, unpackSample } from '@ncc/shared/schema.js';
import { Device } from '../models/index.js';
import { DUPLICATE, OK, SeqWindow, STALE } from './dedup.js';
import { TokenBucket } from './tokenBucket.js';

const envelope = z.object({
  sourceId: z.number().int(),
  samples: z.array(z.any()).max(LIMITS.maxSamplesPerBatch),
});

const sameKey = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Per-source dedup window, rate bucket and last-seen bookkeeping; survives reconnects. */
class Peer {
  constructor() {
    this.window = new SeqWindow(LIMITS.reorderWindow);
    this.bucket = new TokenBucket(LIMITS.sourceRatePerSec, LIMITS.sourceBurst);
    this.lastTs = 0;
    this.dirty = false;
  }
}

export function setupIngest({ io, config, metrics, writer, states, detector, broadcaster, watch, onConnect = () => {}, log }) {
  const nsp = io.of('/ingest');
  const sockets = new Map(); // sourceId -> socket (one live connection per source)
  const peers = new Map(); // sourceId -> Peer

  const peer = (sourceId) => {
    let p = peers.get(sourceId);
    if (!p) peers.set(sourceId, (p = new Peer()));
    return p;
  };

  nsp.use((socket, next) => {
    const { sourceId, key } = socket.handshake.auth ?? {};
    if (!Number.isInteger(sourceId) || sourceId < 1 || sourceId > LIMITS.maxSourceId) return next(new Error('bad sourceId'));
    if (!sameKey(key ?? '', config.deviceKey)) {
      watch.note(sourceId, { refused: 1 }); // counted against the source the caller claimed to be
      metrics.inc('refused');
      return next(new Error('unauthorized'));
    }
    socket.data.sourceId = sourceId;
    next();
  });

  nsp.on('connection', (socket) => {
    const sourceId = socket.data.sourceId;
    sockets.get(sourceId)?.disconnect(true); // a new connection replaces the old one
    sockets.set(sourceId, socket);
    onConnect(sourceId);
    const dev = peer(sourceId);
    const eventBucket = new TokenBucket(40, 80); // batches per second, far above the 10/s a source sends
    socket.on('disconnect', () => {
      if (sockets.get(sourceId) === socket) sockets.delete(sourceId);
    });

    socket.on(EVENTS.BATCH, (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const r = { ok: false, accepted: 0, duplicates: 0, stale: 0, invalid: 0, throttled: 0, credit: 0 };
      const claimed = Array.isArray(payload?.samples) ? Math.min(payload.samples.length, LIMITS.maxSamplesPerBatch) : 1;
      metrics.inc('batches');
      metrics.inc('received', claimed);

      if (!eventBucket.take(1)) {
        r.throttled = claimed;
        metrics.inc('throttled', claimed);
        watch.note(sourceId, { throttled: claimed });
        return reply(r);
      }
      const parsed = envelope.safeParse(payload);
      if (!parsed.success || parsed.data.sourceId !== sourceId) {
        r.invalid = claimed;
        metrics.inc('invalid', claimed);
        watch.note(sourceId, { invalid: claimed });
        return reply(r);
      }

      // 1. per-sample validation
      const valid = [];
      const now = Date.now();
      for (const s of parsed.data.samples) {
        if (checkPacked(s, now, sourceId)) r.invalid++;
        else valid.push(s);
      }
      // 2. token bucket: samples over the allowance are dropped, and so are samples that would grow the write
      // queue past twice its high-water mark (sources that ignore credit 0, or MongoDB down), so memory stays bounded
      const room = Math.max(0, config.highWater * 2 - writer.depth);
      const allowed = dev.bucket.take(Math.min(valid.length, room));
      r.throttled = valid.length - allowed;
      valid.length = allowed;
      // 3. duplicates and reordering
      const fresh = [];
      for (const s of valid) {
        let verdict = dev.window.check(s[0]);
        if (verdict === STALE && s[1] > dev.lastTs + 2000) {
          // a source that restarted begins again at seq 1 with a newer clock: accept the new numbering
          dev.window.reset();
          states.reset(sourceId); // live state keeps the old, higher seq and would ignore every new sample
          verdict = dev.window.check(s[0]);
        }
        if (verdict === DUPLICATE) r.duplicates++;
        else if (verdict === STALE) r.stale++;
        else if (verdict === OK) fresh.push(s);
      }
      fresh.sort((a, b) => a[0] - b[0]);
      r.accepted = fresh.length;

      if (fresh.length) {
        const docs = [];
        const storeEvery = kindOf(sourceId) === 'crew' ? KINDS.crew.storeEvery * config.crewStoreEvery : KINDS.ship.storeEvery;
        for (const p of fresh) {
          const s = unpackSample(p, sourceId);
          if (s.seq % storeEvery === 0) docs.push({ ts: new Date(s.ts), sourceId, ...pick(s, sourceId) });
          // 4. live state and anomaly detection only follow the newest order
          if (states.update(sourceId, s, p)) detector.push(sourceId, s);
          // 6. broadcast queue
          broadcaster.enqueue(sourceId, p);
          if (s.ts > dev.lastTs) dev.lastTs = s.ts;
        }
        // 5. writer queue
        writer.add(docs);
        dev.dirty = true;
      }

      watch.note(sourceId, { invalid: r.invalid, throttled: r.throttled });
      metrics.inc('accepted', r.accepted);
      metrics.inc('duplicates', r.duplicates);
      metrics.inc('stale', r.stale);
      metrics.inc('invalid', r.invalid);
      metrics.inc('throttled', r.throttled);
      r.ok = true;
      r.credit = writer.backpressured ? 0 : config.inflightCredit;
      reply(r);
    });
  });

  return {
    sockets,
    peers,
    /** Relays a command to a source's simulator over EVENTS.COMMAND; false when the source is offline. */
    sendCommand(sourceId, command) {
      const s = sockets.get(sourceId);
      if (!s) return false;
      s.emit(EVENTS.COMMAND, command);
      return true;
    },
    /** Restores dedup windows saved before the last shutdown. */
    async load() {
      for (const d of await Device.find().lean()) {
        const p = peer(d.sourceId);
        p.window.restore(d.lastSeq);
        p.lastTs = d.lastSeenAt ? d.lastSeenAt.getTime() : 0;
      }
    },
    /** Saves the newest seq per source that changed since the last save. */
    async save() {
      const ops = [];
      for (const [sourceId, d] of peers) {
        if (!d.dirty) continue;
        d.dirty = false;
        ops.push({ updateOne: { filter: { sourceId }, update: { $set: { lastSeq: d.window.max, lastSeenAt: new Date(d.lastTs) } }, upsert: true } });
      }
      if (ops.length) await Device.bulkWrite(ops).catch((err) => log.error({ err: err.message }, 'device save failed'));
    },
  };
}

// Channel values only: the stored document keeps seq plus every channel key in real units.
function pick(s, sourceId) {
  const out = { seq: s.seq };
  for (const c of channelsOf(sourceId)) out[c.key] = s[c.key];
  return out;
}
