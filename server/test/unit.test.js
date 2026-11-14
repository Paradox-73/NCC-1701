import test from 'node:test';
import assert from 'node:assert/strict';
import { DUPLICATE, OK, SeqWindow, STALE } from '../src/ingest/dedup.js';
import { TokenBucket } from '../src/ingest/tokenBucket.js';
import { checkSecrets, loadConfig } from '../src/config.js';

test('production refuses the public example secrets; development keeps working with them', () => {
  const prod = { NODE_ENV: 'production' };
  const defaults = loadConfig({ jwtSecret: 'dev-only-secret-change-me', deviceKey: 'dev-device-key' });
  assert.doesNotThrow(() => checkSecrets(defaults, {}));
  assert.throws(() => checkSecrets(defaults, prod), /JWT_SECRET/);
  assert.throws(() => checkSecrets({ jwtSecret: 'a-private-secret', deviceKey: 'dev-device-key' }, prod), /DEVICE_KEY/);
  assert.throws(() => checkSecrets({ jwtSecret: 'change-me-in-real-deployments', deviceKey: 'k' }, prod), /JWT_SECRET/);
  assert.doesNotThrow(() => checkSecrets({ jwtSecret: 'a-private-secret', deviceKey: 'a-private-key' }, prod));
});

test('default MongoDB URI uses 127.0.0.1, so it works where localhost resolves to ::1 first', () => {
  const saved = process.env.MONGO_URI;
  delete process.env.MONGO_URI;
  try {
    assert.equal(loadConfig().mongoUri, 'mongodb://127.0.0.1:27017/ncc1701');
  } finally {
    if (saved !== undefined) process.env.MONGO_URI = saved;
  }
});

test('default CORS origins allow the dashboard on both localhost and 127.0.0.1', () => {
  const saved = process.env.CORS_ORIGIN;
  delete process.env.CORS_ORIGIN;
  try {
    assert.deepEqual(loadConfig().corsOrigin, ['http://localhost:5173', 'http://127.0.0.1:5173']);
  } finally {
    if (saved !== undefined) process.env.CORS_ORIGIN = saved;
  }
});

test('link-loss limit is 1.5 s by default and LINK_LOSS_MS sets it (3000 on the hosted server)', () => {
  const saved = process.env.LINK_LOSS_MS;
  try {
    delete process.env.LINK_LOSS_MS;
    assert.equal(loadConfig().linkLossMs, 1500);
    process.env.LINK_LOSS_MS = '3000';
    assert.equal(loadConfig().linkLossMs, 3000);
    process.env.LINK_LOSS_MS = 'not a number';
    assert.equal(loadConfig().linkLossMs, 1500);
  } finally {
    if (saved === undefined) delete process.env.LINK_LOSS_MS;
    else process.env.LINK_LOSS_MS = saved;
  }
});

test('dedup window: new, duplicate, late inside window, stale outside', () => {
  const w = new SeqWindow(16);
  assert.equal(w.check(1), OK);
  assert.equal(w.check(1), DUPLICATE);
  assert.equal(w.check(5), OK);
  assert.equal(w.check(3), OK); // late but inside the window
  assert.equal(w.check(3), DUPLICATE);
  assert.equal(w.check(40), OK);
  assert.equal(w.check(5), STALE); // 40 - 16 = 24 > 5
  assert.equal(w.check(30), OK);
  assert.equal(w.check(30), DUPLICATE);
});

test('dedup window: restore treats everything up to lastSeq as seen', () => {
  const w = new SeqWindow(16);
  w.restore(100);
  assert.equal(w.check(95), DUPLICATE);
  assert.equal(w.check(101), OK);
});

test('token bucket grants the burst, then refills with time', () => {
  let t = 0;
  const b = new TokenBucket(10, 20, () => t);
  assert.equal(b.take(15), 15);
  assert.equal(b.take(15), 5); // only 5 left
  t = 1000;
  assert.equal(b.take(100), 10); // refilled 10 in a second
  t = 10000;
  assert.equal(b.take(100), 20); // capped at the burst
});
