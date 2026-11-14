// Worker thread: either a group of sources (role 'sources') or a group of dashboard clients (role 'clients').
import { parentPort, workerData } from 'node:worker_threads';
import { io } from 'socket.io-client';
import parser from 'socket.io-msgpack-parser';
import { packSample, CHANNELS, EVENTS } from '@ncc/shared/schema.js';
import { Sender } from '@ncc/simulator/sender.js';
import { Hist } from './hist.js';

const { role, cfg } = workerData;
const SEQ_EPOCH = Date.UTC(2026, 0, 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);

// ---------------------------------------------------------------- sources
async function runSources() {
  const { sourceIds, key, url, hz, inject } = cfg;
  const ack = new Hist();
  const stepMs = 1000 / hz;
  const inj = { dup: 0, reorder: 0, invalid: 0 };
  let connectedAtStart = 0;
  const base = packSample(1, 1.7e12, Object.fromEntries(CHANNELS.map((c) => [c.key, c.nominal])));
  const OUT_OF_RANGE = Math.round(CHANNELS[0].max * CHANNELS[0].scale) + 1_000_000;

  const sources = sourceIds.map((sourceId) => {
    // slot: index of the source's next sample since SEQ_EPOCH, an integer so seq never repeats (rounding the ts first did at 400 Hz)
    const c = { sourceId, slot: Math.ceil((Date.now() - SEQ_EPOCH) / stepMs), held: [], phase: Math.random() * 6 };
    c.sender = new Sender({ url, sourceId, key, hooks: { onAck: (_a, rtt) => ack.add(rtt) } });
    return c;
  });

  const tick = () => {
    const now = Date.now();
    for (const c of sources) {
      const out = c.held; // reordered samples held back from the previous tick go out after this tick's samples
      c.held = [];
      const fresh = [];
      while (SEQ_EPOCH + c.slot * stepMs <= now) {
        const ts = Math.round(SEQ_EPOCH + c.slot * stepMs);
        const s = base.slice();
        s[0] = ++c.slot;
        s[1] = ts;
        // every channel swings 10% of its range around nominal, so the frames carry changing values
        CHANNELS.forEach((ch, k) => {
          s[k + 2] = Math.round(Math.min(ch.max, Math.max(ch.min, ch.nominal + 0.1 * (ch.max - ch.min) * Math.sin(c.phase + k + ts / 3000))) * ch.scale);
        });
        const r = Math.random();
        if (r < inject.invalid) {
          s[2] = OUT_OF_RANGE; // outside the first channel's range
          inj.invalid++;
        } else if (r < inject.invalid + inject.reorder) {
          c.held.push(s);
          inj.reorder++;
          continue;
        } else if (r < inject.invalid + inject.reorder + inject.dup) {
          fresh.push(s.slice());
          inj.dup++;
        }
        fresh.push(s);
      }
      c.sender.push([...fresh, ...out]);
    }
  };
  const timer = setInterval(tick, 100);

  await new Promise((resolve) => parentPort.once('message', (m) => m === 'stop' && resolve()));
  clearInterval(timer);
  for (const c of sources) {
    c.sender.push(c.held);
    if (c.sender.connected) connectedAtStart++;
  }
  await sleep(1200); // let the last batches be acked
  const stats = sources.reduce((a, c) => {
    for (const [k, v] of Object.entries(c.sender.stats)) a[k] = (a[k] ?? 0) + v;
    return a;
  }, {});
  stats.unacked = sources.reduce((n, c) => n + c.sender.inflight.size + c.sender.queue.length, 0);
  sources.forEach((c) => c.sender.close());
  parentPort.postMessage({ role, stats, inj, ack: ack.toJSON(), sourcesConnectedAtEnd: connectedAtStart });
}

// ---------------------------------------------------------------- dashboard clients
async function runClients() {
  const { count, token, url, sourceIds, groups } = cfg;
  const e2e = new Hist();
  const tot = { frames: 0, samples: 0, bytes: 0, overview: 0, connectErrors: 0, disconnects: 0, subscribeFailures: 0 };
  const sockets = [];
  const sizeOf = (d) => (typeof d === 'string' ? d.length : (d?.byteLength ?? d?.length ?? 0));

  let ready = 0;
  for (let i = 0; i < count; i++) {
    const s = io(`${url.replace(/\/$/, '')}/live`, { parser, transports: ['websocket'], auth: { token }, reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 5000 });
    s.on('connect', () => {
      s.io.engine.on('packet', (p) => (tot.bytes += sizeOf(p.data)));
      s.emit(EVENTS.SUBSCRIBE, { sourceIds: pick(sourceIds, 1 + Math.floor(Math.random() * 3)), groups: pick(groups, 1 + Math.floor(Math.random() * groups.length)) }, (r) => {
        if (!r?.ok) tot.subscribeFailures++;
      });
    });
    s.on('connect_error', () => tot.connectErrors++);
    s.on('disconnect', (reason) => reason !== 'io client disconnect' && tot.disconnects++);
    s.on(EVENTS.FRAME, (f) => {
      const now = Date.now();
      tot.frames++;
      for (const smp of f.samples) {
        e2e.add(now - smp[1]);
        tot.samples++;
      }
    });
    s.on(EVENTS.OVERVIEW, () => tot.overview++);
    sockets.push(s);
    if (i % 25 === 24) await sleep(50); // ramp connections instead of opening them in one burst
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 5000 && sockets.some((s) => !s.connected)) await sleep(100);
  parentPort.postMessage({ role, ready: true });

  await new Promise((resolve) => parentPort.once('message', (m) => m === 'stop' && resolve()));
  const connectedAtEnd = sockets.filter((s) => s.connected).length;
  sockets.forEach((s) => s.close());
  parentPort.postMessage({ role, tot, connectedAtEnd, count, e2e: e2e.toJSON() });
}

if (role === 'sources') await runSources();
else await runClients();
