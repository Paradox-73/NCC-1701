import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { io as connect } from 'socket.io-client';
import parser from 'socket.io-msgpack-parser';
import { ROLES, channelsOf, EVENTS, GROUP_CHANNELS, packSample } from '@ncc/shared/schema.js';
import { createServer } from '../src/app.js';

const KEY = 'history-device-key';
const MONGO = 'mongodb://127.0.0.1:27017/ncc_test_history';
// no timer flushes: the tests decide when the write queue drains
const server = createServer({ port: 0, mongoUri: MONGO, logLevel: 'silent', deviceKey: KEY, jwtSecret: 'history-secret', loginRateLimit: 1000, flushMs: 3_600_000 });
let base;
const sockets = [];

before(async () => {
  await mongoose.connect(MONGO);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  base = `http://127.0.0.1:${await server.start()}`;
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.stop();
  const c = await mongoose.createConnection(MONGO).asPromise();
  await c.dropDatabase();
  await c.close();
});

const api = async (path, token, opts = {}) => {
  const r = await fetch(base + path, { ...opts, headers: { ...(token && { authorization: `Bearer ${token}` }), 'content-type': 'application/json' } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const token = async (username, password) => (await api('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ username, password }) })).body.token;
const values = (i) => Object.fromEntries(channelsOf(1).map((c) => [c.key, c.min + ((i % 10) * (c.max - c.min)) / 20]));
const source = async (sourceId) => {
  const s = connect(`${base}/ingest`, { parser, auth: { sourceId, key: KEY }, transports: ['websocket'], reconnection: false });
  sockets.push(s);
  await new Promise((res) => s.once('connect', res));
  return (samples) => new Promise((res) => s.emit(EVENTS.BATCH, { sourceId, samples }, res));
};

test('downsampled history keeps the newest samples: no blank before the live join, never more than maxPoints', async () => {
  // 225 samples against maxPoints 100: between 2 and 3 per point, the case where MongoDB put the whole remainder in one last bucket
  const N = 225;
  const STEP = 20;
  const t0 = Date.now() - N * STEP;
  await mongoose.connection.db.collection('telemetry').insertMany(Array.from({ length: N }, (_, i) => ({ sourceId: 2, seq: i + 1, ts: new Date(t0 + i * STEP), chamberTemp: 40 })));
  const t = await token('command', 'ncc-command');
  const h = (await api(`/api/telemetry?sourceId=2&from=${t0 - 1000}&to=${Date.now() + 1000}&maxPoints=100&keys=chamberTemp`, t)).body;
  assert.equal(h.downsampled, true);
  assert.ok(h.samples.length <= 100, `got ${h.samples.length} points`);
  assert.equal(h.lastSeq, N);
  const ts = h.samples.map((s) => s[1]);
  const gaps = ts.slice(1).map((x, i) => x - ts[i]);
  assert.ok(Math.max(...gaps) <= 3 * STEP, `largest gap ${Math.max(...gaps)} ms`); // buckets hold 3 samples
});

test('history merges stored and still-queued samples, and the live frames after lastSeq continue it without a gap or repeat', async () => {
  await server.writer.drain();
  const t = await token('captain', 'ncc-captain');
  const send = await source(1);
  const seq0 = Math.round(Date.now() / 20);
  const t0 = Date.now() - 1000;
  const batch = (from, to) => Array.from({ length: to - from }, (_, i) => packSample(seq0 + from + i, t0 + (from + i) * 20, values(from + i)));
  await send(batch(0, 3));
  await server.writer.drain(); // stored
  await send(batch(3, 5)); // queued only
  assert.equal(server.writer.depth, 2);
  const h = (await api(`/api/telemetry?sourceId=1&from=${t0 - 1000}&to=${Date.now() + 1000}`, t)).body;
  assert.deepEqual(h.samples.map((s) => s[0]), [0, 1, 2, 3, 4].map((i) => seq0 + i));
  assert.equal(h.lastSeq, seq0 + 4);
  assert.deepEqual(h.samples[0], packSample(seq0, t0, values(0)), 'packed values round-trip exactly');

  // a dashboard that subscribed before the history call buffers frames; dropping seq <= lastSeq leaves the new ones only
  const live = connect(`${base}/live`, { parser, auth: { token: t }, transports: ['websocket'], reconnection: false });
  sockets.push(live);
  const seqs = [];
  live.on(EVENTS.FRAME, (f) => f.samples.forEach((s) => seqs.push(s[0])));
  await new Promise((res) => live.once('connect', res));
  await new Promise((res) => live.emit(EVENTS.SUBSCRIBE, { sourceIds: [1], groups: ['warp'] }, res));
  await send(batch(5, 8));
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(seqs.filter((s) => s > h.lastSeq), [5, 6, 7].map((i) => seq0 + i));
});

test('history is limited to the groups of the caller role, and refuses spans over one hour', async () => {
  const eng = await token('engineer', 'ncc-engineer'); // every ship group except helm, sensors, comms
  const now = Date.now();
  const all = (await api(`/api/telemetry?sourceId=1&from=${now - 60_000}&to=${now}`, eng)).body;
  assert.deepEqual(all.keys, channelsOf(1).filter((c) => ROLES.chief_engineer.groups.includes(c.group)).map((c) => c.key));
  const mixed = (await api(`/api/telemetry?sourceId=1&from=${now - 60_000}&to=${now}&keys=chamberTemp,carrier`, eng)).body;
  assert.deepEqual(mixed.keys, ['chamberTemp']);
  assert.equal((await api(`/api/telemetry?sourceId=1&group=sensors`, eng)).status, 403);
  assert.equal((await api(`/api/telemetry?sourceId=1&keys=carrier`, eng)).status, 403);
  assert.equal((await api(`/api/telemetry?sourceId=2`, eng)).status, 403); // the engineer does not see ship 2
  assert.equal((await api(`/api/telemetry?sourceId=11`, eng)).status, 403); // nor the sickbay
  assert.equal((await api(`/api/telemetry?sourceId=1&keys=nonsense`, eng)).status, 400);
  assert.equal((await api(`/api/telemetry?sourceId=1&from=0`, eng)).status, 400);
  assert.equal((await api(`/api/telemetry?sourceId=1&from=${now - 3600_000}&to=${now}`, eng)).status, 200);
  assert.equal((await api(`/api/telemetry?sourceId=0`, eng)).status, 400);
  assert.equal((await api(`/api/telemetry?sourceId=1`)).status, 401);
});

test('the sources list shows registry sources and which are sending', async () => {
  const t = await token('command', 'ncc-command');
  const { sources } = (await api('/api/sources', t)).body;
  assert.deepEqual(sources.map((s) => s.sourceId), [1, 2, 3, 4]);
  assert.equal(sources.find((s) => s.sourceId === 1).online, true);
  assert.equal(sources.find((s) => s.sourceId === 3).online, false);
});
