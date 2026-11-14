// Ship commands, rooms and the crew hub against a real server, with a stand-in simulator connection.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { io as connect } from 'socket.io-client';
import parser from 'socket.io-msgpack-parser';
import { EVENTS, channelsOf, packSample } from '@ncc/shared/schema.js';
import { createServer } from '../src/app.js';

const KEY = 'ships-device-key';
const MONGO = 'mongodb://127.0.0.1:27017/ncc_test_ships';
const server = createServer({ port: 0, mongoUri: MONGO, logLevel: 'silent', deviceKey: KEY, jwtSecret: 'ships-secret', loginRateLimit: 1000, flushMs: 3_600_000 });
let base;
const sockets = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((res) => s.once(ev, res));
const emitAck = (s, ev, payload) => new Promise((res) => s.emit(ev, payload, res));
const PASSWORDS = { captain: 'ncc-captain', engineer: 'ncc-engineer', medical: 'ncc-medical', science: 'ncc-science', comms: 'ncc-comms', command: 'ncc-command' };
const api = async (path, token, opts = {}) => {
  const r = await fetch(base + path, { ...opts, headers: { ...(token && { authorization: `Bearer ${token}` }), 'content-type': 'application/json' } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const tokens = {};
const token = async (u) => (tokens[u] ??= (await api('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ username: u, password: PASSWORDS[u] }) })).body.token);
const command = async (user, shipId, body) => api(`/api/ships/${shipId}/command`, await token(user), { method: 'POST', body: JSON.stringify(body) });
const open = (ns, auth) => {
  const s = connect(`${base}${ns}`, { parser, auth, transports: ['websocket'], reconnection: false });
  sockets.push(s);
  return s;
};
const dash = async (user) => {
  const s = open('/live', { token: await token(user) });
  const got = { frames: [], events: [] };
  s.on(EVENTS.FRAME, (f) => got.frames.push(f));
  for (const ev of [EVENTS.COMMAND_ACK, EVENTS.SHIP_LOG, EVENTS.SHIP_CONDITION, EVENTS.SCENARIO]) s.on(ev, (p) => got.events.push([ev, p]));
  await once(s, 'connect');
  return { s, got };
};
const sim = async (sourceId) => {
  const s = open('/ingest', { sourceId, key: KEY });
  const cmds = [];
  s.on(EVENTS.COMMAND, (c) => cmds.push(c));
  await once(s, 'connect');
  return { s, cmds, send: (samples) => emitAck(s, EVENTS.BATCH, { sourceId, samples }) };
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

test('a command is validated, checked against the role, relayed to the simulator, logged and acknowledged to the ship room', async () => {
  const ship = await sim(1);
  const bridge = await dash('captain');
  const engineer = await dash('engineer');
  const science = await dash('science');
  const r = await command('captain', 1, { type: 'helm.warp', factor: 6 });
  assert.deepEqual([r.status, r.body.ok, r.body.text], [200, true, 'Warp factor 6, aye']);
  assert.equal(typeof r.body.at, 'number');
  await sleep(200);
  assert.deepEqual(ship.cmds, [{ type: 'helm.warp', args: { factor: 6 } }]);
  for (const d of [bridge, engineer, science]) {
    const ev = Object.fromEntries(d.got.events);
    assert.deepEqual([ev['command:ack'].type, ev['command:ack'].by, ev.log.text], ['helm.warp', 'captain', 'Warp factor 6, aye']);
  }
  const state = (await api('/api/ships/1/state', await token('captain'))).body;
  assert.equal(state.condition, 'normal');
  assert.equal(state.log.at(-1).text, 'Warp factor 6, aye');
  assert.ok(state.log.at(-1).stardate > 4000);
});

test('wrong role is 403, unknown type or bad payload is 400, a ship the role cannot see is 403, a missing simulator is 409', async () => {
  assert.equal((await command('comms', 1, { type: 'tactical.phasers', bank: 'fore' })).status, 403);
  assert.equal((await command('engineer', 1, { type: 'helm.warp', factor: 3 })).status, 403);
  assert.equal((await command('captain', 1, { type: 'sim.fault', fault: 'mute' })).status, 403);
  assert.equal((await command('captain', 1, { type: 'helm.teleport' })).status, 400);
  assert.equal((await command('captain', 1, { type: 'helm.warp', factor: 12 })).status, 400);
  assert.equal((await command('captain', 1, { type: 'helm.warp', factor: 3, extra: 1 })).status, 400);
  assert.equal((await command('captain', 1, { type: 'helm.heading' })).status, 400);
  assert.equal((await command('captain', 2, { type: 'helm.warp', factor: 3 })).status, 403);
  assert.equal((await command('captain', 11, { type: 'helm.warp', factor: 3 })).status, 404);
  assert.equal((await api('/api/ships/1/command', null, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await command('command', 3, { type: 'sim.fault', fault: 'storm' })).status, 409);
  assert.equal((await command('captain', 1, { type: 'comms.hail', target: 'command' })).status, 200);
  assert.equal((await command('comms', 1, { type: 'comms.close' })).status, 200);
});

test('ship condition changes on the server, reaches the simulator and the ship room, and is resent to a simulator that reconnects', async () => {
  const bridge = await dash('captain');
  const ship = await sim(1);
  assert.equal((await command('captain', 1, { type: 'ship.condition', level: 'red' })).status, 200);
  await sleep(200);
  assert.deepEqual(ship.cmds.at(-1), { type: 'ship.condition', args: { level: 'red' } });
  assert.equal(bridge.got.events.find(([k]) => k === EVENTS.SHIP_CONDITION)[1].level, 'red');
  assert.equal((await api('/api/ships/1/state', await token('captain'))).body.condition, 'red');
  const again = await sim(1);
  await sleep(200);
  assert.deepEqual(again.cmds, [{ type: 'ship.condition', args: { level: 'red' } }]);
  await command('captain', 1, { type: 'ship.condition', level: 'normal' });
});

test('scenario-only commands are refused with 409 when no scenario waits for them; scenario commands are for the captain and Starfleet Command', async () => {
  assert.equal((await command('captain', 1, { type: 'engineering.coldRestart' })).status, 409);
  assert.equal((await command('engineer', 1, { type: 'engineering.coldRestart' })).status, 409);
  assert.equal((await command('captain', 1, { type: 'security.ventGas', deck: 11 })).status, 409);
  assert.equal((await command('engineer', 1, { type: 'scenario.start', id: 'balance-of-terror' })).status, 403);
  assert.equal((await command('captain', 1, { type: 'scenario.start', id: 'no-such-episode' })).status, 404);
  assert.equal((await command('command', 1, { type: 'scenario.stop' })).status, 409);
  const { scenarios, status } = (await api('/api/scenarios', await token('captain'))).body;
  assert.ok(Array.isArray(scenarios));
  assert.equal(status, null);
});

test('commands are limited to 10 a second per user, with a burst of 20', async () => {
  const codes = [];
  for (let i = 0; i < 30; i++) codes.push((await command('science', 1, { type: 'science.scan', mode: 'long' })).status);
  assert.ok(codes.includes(429), `no 429 in ${codes.join(',')}`);
  assert.equal(codes[0], 200);
});

test('the sickbay hub stores 1,720 vitals per sample; only the captain and the chief medical officer receive them', async () => {
  const hub = await sim(11);
  const med = await dash('medical');
  const cap = await dash('captain');
  const eng = await dash('engineer');
  const cmd = await dash('command');
  assert.deepEqual((await emitAck(med.s, EVENTS.SUBSCRIBE, { sourceIds: [11], groups: ['bio-d07'] })).rooms, ['src:11:bio-d07']);
  assert.deepEqual((await emitAck(cap.s, EVENTS.SUBSCRIBE, { sourceIds: [11], groups: ['bio-d07'] })).rooms, ['src:11:bio-d07']);
  const denied = await emitAck(eng.s, EVENTS.SUBSCRIBE, { sourceIds: [11], groups: ['bio-d07'] });
  assert.deepEqual([denied.rooms, denied.denied, denied.deniedSources], [[], ['bio-d07'], [11]]);
  const cdenied = await emitAck(cmd.s, EVENTS.SUBSCRIBE, { sourceIds: [11], groups: ['bio-d07'] });
  assert.deepEqual([cdenied.rooms, cdenied.denied, cdenied.deniedSources], [[], ['bio-d07'], [11]], 'not even Starfleet Command sees individual vitals');
  const values = Object.fromEntries(channelsOf(11).map((c) => [c.key, c.nominal]));
  const seq = Math.round(Date.now() / 1000);
  const ack = await hub.send([packSample(seq, Date.now(), values, 11)]);
  assert.deepEqual([ack.accepted, ack.invalid], [1, 0]);
  await sleep(300);
  assert.equal(med.got.frames.length, 1);
  assert.equal(med.got.frames[0].keys.length, 152, 'deck 7 holds 38 crew with four vitals');
  assert.deepEqual(eng.got.frames.concat(cmd.got.frames), []);
  const wrong = await hub.send([packSample(seq + 1, Date.now(), Object.fromEntries(channelsOf(1).map((c) => [c.key, c.nominal])), 1)]);
  assert.equal(wrong.invalid, 1, 'a ship sample on the sickbay link is refused');
  await server.writer.drain();
  const doc = await mongoose.connection.db.collection('telemetry').findOne({ sourceId: 11 });
  assert.equal(Object.keys(doc).filter((k) => /^(hr|rr|bt|nr)_\d{3}$/.test(k)).length, 1720);
});

test('the overview carries a row per ship with flags (online plus the open alert level), condition, warp, weakest shield, position and heading', async () => {
  const ship = await sim(2);
  const v = Object.fromEntries(channelsOf(2).map((c) => [c.key, c.nominal]));
  Object.assign(v, { warpFactor: 7.5, shieldAft: 41.5, posX: 12.3, posY: -4.5, heading: 270 });
  await ship.send([packSample(Math.round(Date.now() / 20), Date.now(), v, 2)]);
  const bridge = await dash('captain');
  const o = await new Promise((res) => bridge.s.on(EVENTS.OVERVIEW, (p) => p.sources.some((r) => r[0] === 2) && res(p)));
  assert.deepEqual(o.sources.find((r) => r[0] === 2), [2, 3, 0, 750, 415, 123, -45, 2700]);
  assert.ok(o.sources.every((r) => r.length === 8 && r[0] < 5), 'ships only');
});
