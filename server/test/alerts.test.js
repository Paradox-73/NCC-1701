// Alert history, REST acknowledgement, the admin command channel, and the restart rule: a server that starts closes
// the alerts its predecessor left open, because the detector that would clear them is gone.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { io as connect } from 'socket.io-client';
import parser from 'socket.io-msgpack-parser';
import { EVENTS } from '@ncc/shared/schema.js';
import { Alert } from '../src/models/index.js';
import { createServer } from '../src/app.js';

const MONGO = 'mongodb://127.0.0.1:27017/ncc_test_alerts';
const server = createServer({ port: 0, mongoUri: MONGO, logLevel: 'silent', deviceKey: 'k', jwtSecret: 'test-secret', loginRateLimit: 1000 });
const old = { sourceId: 1, ts: Date.now() - 60_000, value: 2, threshold: 1.5 };
let base;
const sockets = [];

before(async () => {
  await mongoose.connect(MONGO);
  await mongoose.connection.dropDatabase();
  await Alert.create([
    { ...old, type: 'link-loss', channel: 'samples', group: null, severity: 'warn', message: 'No samples for 2.0 s' },
    { ...old, type: 'chamber-temp', channel: 'chamberTemp', group: 'warp', severity: 'critical', ack: { by: 'captain', at: Date.now() }, message: 'Reaction chamber temperature 90 MK' },
    { ...old, type: 'oxygen-low', channel: 'o2_01', group: 'lifesupport', severity: 'info', message: 'Oxygen, deck 1 18.9 %' },
    { ...old, type: 'shield-low', channel: 'shieldAft', group: 'shields', severity: 'warn', message: 'Shield aft 25 %' },
  ]);
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
const list = async (t, q = '') => (await api(`/api/alerts${q}`, t)).body.alerts;

test('on start, unacknowledged warn and critical alerts are resolved with a reason; acknowledged and info alerts are left alone', async () => {
  const alerts = await list(await token('captain', 'ncc-captain'));
  const by = Object.fromEntries(alerts.map((a) => [a.type, a]));
  assert.equal(by['link-loss'].resolved.reason, 'server restarted');
  assert.ok(by['link-loss'].resolved.at > old.ts);
  assert.deepEqual([by['link-loss'].ack.by, by['link-loss'].ack.reason], ['system', 'server restarted']);
  assert.equal(by['chamber-temp'].resolved, null);
  assert.equal(by['chamber-temp'].ack.by, 'captain'); // a person's acknowledgement is kept
  assert.equal(by['oxygen-low'].resolved, null);
  assert.equal(by['oxygen-low'].ack, null);
  assert.deepEqual((await list(await token('captain', 'ncc-captain'), '?unacked=1')).map((a) => a.type), ['oxygen-low']);
});

test('the alert list holds the caller groups plus group-less alerts', async () => {
  const types = async (u, p) => (await list(await token(u, p))).map((a) => a.type).sort();
  assert.deepEqual(await types('engineer', 'ncc-engineer'), ['chamber-temp', 'link-loss', 'oxygen-low', 'shield-low']);
  assert.deepEqual(await types('medical', 'ncc-medical'), ['link-loss', 'oxygen-low']);
  assert.deepEqual(await types('comms', 'ncc-comms'), ['link-loss']);
  assert.equal((await api('/api/alerts?limit=0', await token('captain', 'ncc-captain'))).status, 400);
});

test('REST acknowledgement follows the role: canAck and the alert group; a repeat is a harmless no-op', async () => {
  const cap = await token('captain', 'ncc-captain');
  server.alerts.raise({ sourceId: 1, ts: Date.now(), type: 'shield-low', group: 'shields', channel: 'shieldFore', value: 20, threshold: 30, severity: 'warn', message: 'Shield fore 20 %' });
  await new Promise((r) => setTimeout(r, 200)); // the alert is saved in the background
  const shield = (await list(cap, '?sourceId=1')).find((a) => a.type === 'shield-low');
  assert.equal((await api(`/api/alerts/${shield.id}/ack`, await token('comms', 'ncc-comms'), { method: 'POST' })).status, 403); // the role cannot see the shields group
  assert.equal((await api(`/api/alerts/${shield.id}/ack`, await token('medical', 'ncc-medical'), { method: 'POST' })).status, 403); // not their group
  assert.equal((await api('/api/alerts/ffffffffffffffffffffffff/ack', cap, { method: 'POST' })).status, 404);
  const ok = await api(`/api/alerts/${shield.id}/ack`, await token('engineer', 'ncc-engineer'), { method: 'POST' });
  assert.deepEqual([ok.status, ok.body.alreadyAcked, ok.body.alert.ack.by], [200, false, 'engineer']);
  const again = await api(`/api/alerts/${shield.id}/ack`, cap, { method: 'POST' });
  assert.equal(again.body.alreadyAcked, true);
});

test('metrics and the command channel are for Starfleet Command only, and the command reaches the source', async () => {
  const cmd = await token('command', 'ncc-command');
  assert.equal((await api('/api/metrics', await token('captain', 'ncc-captain'))).status, 403);
  assert.equal((await api('/api/metrics', cmd)).status, 200);
  const body = JSON.stringify({ type: 'fault', args: { channel: 'chamberTemp' } });
  assert.equal((await api('/api/sim/1/command', await token('captain', 'ncc-captain'), { method: 'POST', body })).status, 403);
  assert.equal((await api('/api/sim/1/command', cmd, { method: 'POST', body })).status, 409); // nothing connected yet

  const source = connect(`${base}/ingest`, { parser, auth: { sourceId: 1, key: 'k' }, transports: ['websocket'], reconnection: false });
  sockets.push(source);
  await new Promise((res) => source.once('connect', res));
  const got = new Promise((res) => source.once(EVENTS.COMMAND, res));
  const r = await api('/api/sim/1/command', cmd, { method: 'POST', body });
  assert.equal(r.status, 200);
  assert.deepEqual(await got, { type: 'fault', args: { channel: 'chamberTemp' } });
  assert.equal((await api('/api/sim/1/command', cmd, { method: 'POST', body: JSON.stringify({ type: 'Bad Type!' }) })).status, 400);
});
