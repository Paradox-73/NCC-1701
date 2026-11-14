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

test('TTL settings come from the environment, with defaults of 24 hours and 7 days', () => {
  const saved = [process.env.TELEMETRY_TTL_SEC, process.env.ALERTS_TTL_SEC];
  delete process.env.TELEMETRY_TTL_SEC;
  delete process.env.ALERTS_TTL_SEC;
  try {
    assert.equal(loadConfig().telemetryTtlSec, 86400);
    assert.equal(loadConfig().alertsTtlSec, 604800);
    process.env.TELEMETRY_TTL_SEC = '10800';
    process.env.ALERTS_TTL_SEC = '86400';
    assert.equal(loadConfig().telemetryTtlSec, 10800);
    assert.equal(loadConfig().alertsTtlSec, 86400);
  } finally {
    for (const [k, v] of [['TELEMETRY_TTL_SEC', saved[0]], ['ALERTS_TTL_SEC', saved[1]]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});
