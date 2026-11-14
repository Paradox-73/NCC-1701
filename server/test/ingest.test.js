import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { io as connect } from 'socket.io-client';
import parser from 'socket.io-msgpack-parser';
import { CHANNELS, EVENTS, packSample } from '@ncc/shared/schema.js';
import { createServer } from '../src/app.js';

const KEY = 'test-device-key';
const MONGO = 'mongodb://127.0.0.1:27017/ncc_test_ingest';
// No timer flushes (flushMs one hour): each test decides when the write queue drains. A small high-water mark makes the queue cap reachable.
const HIGH_WATER = 50;
const server = createServer({ port: 0, mongoUri: MONGO, logLevel: 'silent', deviceKey: KEY, jwtSecret: 'test-secret', loginRateLimit: 1000, flushMs: 3_600_000, highWater: HIGH_WATER });
let base;
const sockets = [];
const T0 = Date.now() - 10_000;

const values = (i) => Object.fromEntries(CHANNELS.map((c) => [c.key, Math.min(c.max, c.min + (((i * 7) % 50) * (c.max - c.min)) / 100)]));
const sample = (seq, ts = T0 + seq * 5) => packSample(seq, ts, values(seq));
const freshSeq = () => Math.round(Date.now() / 20); // above anything an earlier test sent
const open = (ns, auth) => {
  const s = connect(`${base}${ns}`, { parser, auth, transports: ['websocket'], reconnection: false });
  sockets.push(s);
  return s;
};
const once = (s, ev) => new Promise((res) => s.once(ev, res));
const emitAck = (s, ev, payload) => new Promise((res) => s.emit(ev, payload, res));
const source = async (sourceId) => {
  const s = open('/ingest', { sourceId, key: KEY });
  await once(s, 'connect');
  return Object.assign((samples, id = sourceId) => emitAck(s, EVENTS.BATCH, { sourceId: id, samples }), { socket: s });
};

before(async () => {
  await mongoose.connect(MONGO);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  base = `http://127.0.0.1:${await server.start()}`;
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.stop(); // flushes the writer and saves device state, so drop afterwards
  const c = await mongoose.createConnection(MONGO).asPromise();
  await c.dropDatabase();
  await c.close();
});

test('ingest validates, de-duplicates and reorders, and stores each accepted sample once', async () => {
  const bad = open('/ingest', { sourceId: 1, key: 'nope' });
  assert.equal((await once(bad, 'connect_error')).message, 'unauthorized');
  const outside = open('/ingest', { sourceId: 0, key: KEY });
  assert.equal((await once(outside, 'connect_error')).message, 'bad sourceId');

  const send = await source(1);
  const a1 = await send([1, 2, 3, 4, 5].map((n) => sample(n)));
  assert.deepEqual(a1, { ok: true, accepted: 5, duplicates: 0, stale: 0, invalid: 0, throttled: 0, credit: 4 });
  const a2 = await send([3, 4, 5, 6, 7].map((n) => sample(n))); // 3 duplicates
  assert.deepEqual([a2.accepted, a2.duplicates], [2, 3]);
  const a3 = await send([10, 9, 8].map((n) => sample(n))); // out of order, all accepted
  assert.equal(a3.accepted, 3);
  const wrongLength = sample(11).slice(0, 5);
  const outOfRange = sample(12);
  outOfRange[2] = 99999; // warp factor above its max
  const a4 = await send([wrongLength, outOfRange, sample(11)]);
  assert.deepEqual([a4.accepted, a4.invalid], [1, 2]);
  assert.equal((await send([sample(1000)])).accepted, 1);
  const stale = await send([sample(2)]); // older than the 256-sample window
  assert.deepEqual([stale.accepted, stale.stale], [0, 1]);
  assert.equal((await send(Array.from({ length: 101 }, (_, i) => sample(2000 + i)))).ok, false); // over maxSamplesPerBatch
  assert.equal((await send([sample(2001)], 2)).ok, false); // sourceId does not match the handshake

  await server.writer.drain();
  const stored = (await mongoose.connection.db.collection('telemetry').find({ sourceId: 1 }).toArray()).map((d) => d.seq).sort((a, b) => a - b);
  assert.deepEqual(stored, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 1000]);
  const t = server.metrics.totals;
  assert.deepEqual([t.accepted, t.duplicates, t.stale, t.invalid], [12, 3, 1, 2 + 100 + 1]);
});

test('ingest rejects timestamps far in the future and seq numbers beyond safe integers', async () => {
  await server.writer.drain();
  const send = await source(30);
  const seq = freshSeq();
  const now = Date.now();
  const ack = await send([sample(seq, now + 3600_000), sample(2 ** 60, now), sample(seq + 1, now), sample(seq + 2, now + 5000)]);
  assert.deepEqual([ack.accepted, ack.invalid], [2, 2]);
});

test('the write queue has a hard cap, also for a source that ignores credit 0', async () => {
  await server.writer.drain();
  const send = await source(31);
  let seq = freshSeq();
  const batch = (n) => Array.from({ length: n }, () => sample(seq++, Date.now()));
  const a1 = await send(batch(100));
  assert.deepEqual([a1.accepted, a1.credit], [100, 0]);
  const a2 = await send(batch(10));
  assert.deepEqual([a2.accepted, a2.throttled, a2.credit], [0, 10, 0]);
  assert.equal(server.writer.depth, 2 * HIGH_WATER);
  await server.writer.drain();
  assert.equal((await send(batch(10))).accepted, 10);
});

test('a source that restarts with a lower seq stays in live state and keeps being accepted', async () => {
  const send = await source(3);
  const start = freshSeq() + 100_000;
  const now = Date.now();
  assert.equal((await send([sample(start, now), sample(start + 1, now + 20)])).accepted, 2);
  assert.equal(server.states.sources.get(3).seq, start + 1);
  // restart: seq begins at 1 again with a clock more than 2 s ahead
  assert.equal((await send([sample(1, now + 5000), sample(2, now + 5020)])).accepted, 2);
  const c = server.states.sources.get(3);
  assert.equal(c.seq, 2);
  assert.ok(server.states.isActive(c));
});

test('the command channel reaches a connected source and reports an offline one', async () => {
  const send = await source(4);
  const got = once(send.socket, EVENTS.COMMAND);
  assert.equal(server.ingest.sendCommand(4, { type: 'scenario', name: 'test' }), true);
  assert.deepEqual(await got, { type: 'scenario', name: 'test' });
  assert.equal(server.ingest.sendCommand(77, { type: 'x' }), false);
});
