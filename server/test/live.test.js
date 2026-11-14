import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { io as connect } from 'socket.io-client';
import parser from 'socket.io-msgpack-parser';
import { channelsOf, EVENTS, GROUP_CHANNELS, KINDS, packSample } from '@ncc/shared/schema.js';
import { createServer } from '../src/app.js';

const KEY = 'test-device-key';
const MONGO = 'mongodb://127.0.0.1:27017/ncc_test_live';
const server = createServer({ port: 0, mongoUri: MONGO, logLevel: 'silent', deviceKey: KEY, jwtSecret: 'test-secret', loginRateLimit: 1000 });
let base;
const sockets = [];

const values = (i) => Object.fromEntries(channelsOf(1).map((c) => [c.key, c.min + ((i % 10) * (c.max - c.min)) / 20]));
const sample = (seq) => packSample(seq, Date.now(), values(seq));
const open = (ns, auth) => {
  const s = connect(`${base}${ns}`, { parser, auth, transports: ['websocket'], reconnection: false });
  sockets.push(s);
  return s;
};
const once = (s, ev) => new Promise((res) => s.once(ev, res));
const emitAck = (s, ev, payload) => new Promise((res) => s.emit(ev, payload, res));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, token, opts = {}) => {
  const r = await fetch(base + path, { ...opts, headers: { ...(token && { authorization: `Bearer ${token}` }), 'content-type': 'application/json' } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const PASSWORDS = { captain: 'ncc-captain', engineer: 'ncc-engineer', medical: 'ncc-medical', comms: 'ncc-comms', command: 'ncc-command' };
// connects a dashboard as `username` and collects what it receives
const dash = async (username) => {
  const { token } = (await api('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ username, password: PASSWORDS[username] }) })).body;
  const s = open('/live', { token });
  const got = { frames: [], alerts: [], acks: [], overview: [], metrics: [] };
  s.on(EVENTS.FRAME, (f) => got.frames.push(f));
  s.on(EVENTS.ALERT, (a) => got.alerts.push(a));
  s.on(EVENTS.ALERT_ACK, (a) => got.acks.push(a));
  s.on(EVENTS.OVERVIEW, (o) => got.overview.push(o));
  s.on(EVENTS.METRICS, (m) => got.metrics.push(m));
  await once(s, 'connect');
  return { s, got, token };
};

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

test('a dashboard without a valid token is refused', async () => {
  const s = open('/live', { token: 'nope' });
  assert.equal((await once(s, 'connect_error')).message, 'unauthorized');
});

test('subscriptions follow the role: only permitted groups join, and frames carry only the subscribed group', async () => {
  const eng = await dash('engineer'); // every ship group except helm, sensors and comms
  const sub = await emitAck(eng.s, EVENTS.SUBSCRIBE, { sourceIds: [1], groups: ['warp', 'sensors'] });
  assert.deepEqual(sub, { ok: true, rooms: ['src:1:warp'], denied: ['sensors'], deniedSources: [] });
  const wrongKind = await emitAck(eng.s, EVENTS.SUBSCRIBE, { sourceIds: [1, 2, 11], groups: ['warp'] });
  assert.deepEqual([wrongKind.rooms, wrongKind.deniedSources], [['src:1:warp'], [2, 11]]); // the engineer sees neither ship 2 nor the sickbay
  const cap = await dash('captain');
  const all = await emitAck(cap.s, EVENTS.SUBSCRIBE, { sourceIds: [1] }); // no groups: every group the role may see
  assert.deepEqual(all.rooms, KINDS.ship.groups.map((g) => `src:1:${g}`)); // a ship has no biosign groups
  const hub = await emitAck(cap.s, EVENTS.SUBSCRIBE, { sourceIds: [11] });
  assert.deepEqual(hub.rooms, KINDS.crew.groups.map((g) => `src:11:${g}`));
  const bad = await emitAck(cap.s, EVENTS.SUBSCRIBE, { sourceIds: [1], groups: ['bridge'] });
  assert.deepEqual(bad, { ok: false, error: 'invalid payload' });

  const source = open('/ingest', { sourceId: 1, key: KEY });
  await once(source, 'connect');
  await emitAck(source, EVENTS.BATCH, { sourceId: 1, samples: [1, 2, 3].map(sample) });
  await sleep(300);
  assert.ok(eng.got.frames.length > 0);
  assert.ok(eng.got.frames.every((f) => f.group === 'warp' && f.sourceId === 1));
  assert.deepEqual(eng.got.frames[0].keys, GROUP_CHANNELS.warp);
  assert.deepEqual(eng.got.frames.flatMap((f) => f.samples.map((s) => s[0])).sort(), [1, 2, 3]);
  assert.deepEqual(new Set(cap.got.frames.map((f) => f.group)), new Set(KINDS.ship.groups));

  await emitAck(eng.s, EVENTS.UNSUBSCRIBE, { sourceIds: [1] });
  const before = eng.got.frames.length;
  await emitAck(source, EVENTS.BATCH, { sourceId: 1, samples: [4].map(sample) });
  await sleep(250);
  assert.equal(eng.got.frames.length, before);
});

test('alerts reach only roles that may see their group; link loss reaches everyone', async () => {
  const [eng, med, comms] = await Promise.all(['engineer', 'medical', 'comms'].map(dash));
  const alert = { sourceId: 1, ts: Date.now(), type: 'chamber-temp', channel: 'chamberTemp', value: 80, threshold: 70, severity: 'warn', message: 'x' };
  server.alerts.raise({ ...alert, group: 'warp' });
  server.alerts.raise({ ...alert, type: 'link-loss', channel: 'samples', group: null });
  await sleep(200);
  assert.deepEqual(eng.got.alerts.map((a) => a.type).sort(), ['chamber-temp', 'link-loss']);
  assert.deepEqual(med.got.alerts.map((a) => a.type), ['link-loss']);
  assert.deepEqual(comms.got.alerts.map((a) => a.type), ['link-loss']);
});

test('acknowledging needs a role with canAck and the alert group; the ack is broadcast to that group only', async () => {
  const [eng, med, comms, cap] = await Promise.all(['engineer', 'medical', 'comms', 'captain'].map(dash));
  server.alerts.raise({ sourceId: 1, ts: Date.now(), type: 'chamber-temp', group: 'warp', channel: 'chamberTemp', value: 80, threshold: 70, severity: 'warn', message: 'x' });
  await sleep(200);
  const id = eng.got.alerts.at(-1).id;
  assert.deepEqual(await emitAck(comms.s, EVENTS.ALERT_ACK, { id }), { ok: false }); // may acknowledge, but not warp alerts
  assert.deepEqual(await emitAck(med.s, EVENTS.ALERT_ACK, { id }), { ok: false }); // may acknowledge, but not warp alerts
  assert.deepEqual(await emitAck(eng.s, EVENTS.ALERT_ACK, { id }), { ok: true });
  assert.deepEqual(await emitAck(cap.s, EVENTS.ALERT_ACK, { id }), { ok: false }); // already acknowledged
  await sleep(200);
  assert.deepEqual(eng.got.acks, [{ id, by: 'engineer' }]);
  assert.deepEqual(cap.got.acks, [{ id, by: 'engineer' }]);
  assert.deepEqual(med.got.acks, []);
});

test('everyone gets the overview with the live data rate; only Starfleet Command gets metrics', async () => {
  const [cap, cmd] = await Promise.all(['captain', 'command'].map(dash));
  const source = open('/ingest', { sourceId: 2, key: KEY });
  await once(source, 'connect');
  await emitAck(source, EVENTS.BATCH, { sourceId: 2, samples: [1, 2].map(sample) });
  await sleep(1400);
  const o = cap.got.overview.at(-1);
  assert.equal(o.sources.some(([id]) => id === 2), false, 'the captain has no row for a sister ship');
  assert.ok(cmd.got.overview.at(-1).sources.some(([id, flags]) => id === 2 && (flags & 1) === 1));
  assert.equal(typeof o.rx, 'number');
  assert.equal(cap.got.metrics.length, 0);
  assert.ok(cmd.got.metrics.length > 0);
});
