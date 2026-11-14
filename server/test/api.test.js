import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import { io as connect } from 'socket.io-client';
import parser from 'socket.io-msgpack-parser';
import { ROLES } from '@ncc/shared/schema.js';
import { createServer } from '../src/app.js';
import { errorHandler } from '../src/middleware/index.js';
import { authRoutes } from '../src/routes/auth.js';
import { USERS } from '../src/seed.js';

const MONGO = 'mongodb://127.0.0.1:27017/ncc_test_api';
const server = createServer({ port: 0, mongoUri: MONGO, logLevel: 'silent', deviceKey: 'k', jwtSecret: 'test-secret', loginRateLimit: 1000 });
let base;
const once = (s, ev) => new Promise((res) => s.once(ev, res));
const api = async (path, token, opts = {}) => {
  const r = await fetch(base + path, { ...opts, headers: { ...(token && { authorization: `Bearer ${token}` }), 'content-type': 'application/json' } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (username, password) => (await api('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ username, password }) })).body;

before(async () => {
  await mongoose.connect(MONGO);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  base = `http://127.0.0.1:${await server.start()}`;
});

after(async () => {
  await server.stop();
  const c = await mongoose.createConnection(MONGO).asPromise();
  await c.dropDatabase();
  await c.close();
});

test('every seeded role signs in and gets its registry groups; a wrong password and a missing token are refused', async () => {
  for (const u of USERS) {
    const { token, user } = await login(u.username, u.password);
    assert.deepEqual(user.groups, ROLES[u.role].groups, u.role);
    const me = await api('/api/auth/me', token);
    assert.equal(me.body.user.role, u.role);
  }
  assert.equal((await api('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ username: 'captain', password: 'nope' }) })).status, 401);
  assert.equal((await api('/api/auth/me')).status, 401);
  assert.equal((await api('/api/auth/me', 'garbage')).status, 401);
});

test('health reports MongoDB; unknown API paths are 404 with a token and 401 without', async () => {
  assert.deepEqual((await api('/api/health')).body.mongo, 'connected');
  const { token } = await login('captain', 'ncc-captain');
  assert.equal((await api('/api/nothing', token)).status, 404);
  assert.equal((await api('/api/nothing')).status, 401);
});

test('client errors keep their 4xx status instead of a 500', async () => {
  const big = JSON.stringify({ username: 'captain', password: 'x'.repeat(150_000) });
  const tooBig = await api('/api/auth/login', null, { method: 'POST', body: big });
  assert.deepEqual([tooBig.status, tooBig.body.error], [413, 'request entity too large']);
  assert.equal((await api('/api/auth/login', null, { method: 'POST', body: '{"username":' })).status, 400);
});

test('the default Socket.IO namespace refuses connections', async () => {
  const s = connect(`${base}/`, { parser, auth: {}, transports: ['websocket'], reconnection: false });
  const outcome = await new Promise((res) => {
    s.once('connect', () => res('connected'));
    s.once('connect_error', (e) => res(e.message));
  });
  s.close();
  assert.equal(outcome, 'unauthorized');
});

test('the login rate limit counts failed attempts only', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', authRoutes({ config: { loginRateLimit: 2, jwtSecret: 'x' } }));
  app.use(errorHandler({ error() {} }));
  const srv = app.listen(0);
  await once(srv, 'listening');
  const post = (password) => fetch(`http://127.0.0.1:${srv.address().port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'captain', password }) });
  try {
    for (let i = 0; i < 4; i++) assert.equal((await post('ncc-captain')).status, 200);
    assert.equal((await post('nope')).status, 401);
    assert.equal((await post('nope')).status, 401);
    assert.equal((await post('nope')).status, 429);
  } finally {
    srv.close();
  }
});
