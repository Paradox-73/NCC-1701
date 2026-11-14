import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectDb, disconnectDb, ensureAlertsTtl, ensureTelemetry } from '../src/db.js';
import { Alert } from '../src/models/index.js';
import { loadConfig } from '../src/config.js';

const URI = 'mongodb://127.0.0.1:27017/ncc_test_ttl';
await mongoose.connect(URI);
await mongoose.connection.dropDatabase();
await mongoose.disconnect();
await connectDb(URI);

after(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectDb();
});

const alertsIndex = async () => (await mongoose.connection.db.collection('alerts').indexes()).find((i) => i.name === 'createdAt_ttl');

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

test('telemetry expiry is set on creation and changed with collMod when the setting changes', async () => {
  const expiry = async () => (await mongoose.connection.db.listCollections({ name: 'telemetry' }).next()).options.expireAfterSeconds;
  await ensureTelemetry(3600);
  assert.equal(await expiry(), 3600);
  await ensureTelemetry(7200);
  assert.equal(await expiry(), 7200);
});

const plainTelemetry = async () => {
  const db = mongoose.connection.db;
  const info = await db.listCollections({ name: 'telemetry' }).next();
  const indexes = await db.collection('telemetry').indexes();
  return { type: info.type, timeseries: Boolean(info.options.timeseries), keys: indexes.find((i) => i.name === 'sourceId_1_ts_1')?.key, ttl: indexes.find((i) => i.name === 'ts_ttl')?.expireAfterSeconds };
};
// stands in for a server that answers createCollection with an error, such as a cluster that refuses time series
const withCreateCollection = async (fail, fn) => {
  const db = mongoose.connection.db;
  const original = db.createCollection;
  db.createCollection = async () => {
    throw fail;
  };
  try {
    return await fn();
  } finally {
    db.createCollection = original;
  }
};

test('when the server refuses time series, telemetry is a plain collection with the query index, the same expiry and one warning', async () => {
  await mongoose.connection.db.collection('telemetry').drop().catch(() => {});
  const warnings = [];
  const log = { warn: (_obj, msg) => warnings.push(msg) };
  const refusal = new mongoose.mongo.MongoServerError({ message: 'createCollection is not allowed or the syntax is incorrect', code: 8000, codeName: 'AtlasError' });
  const col = await withCreateCollection(refusal, () => ensureTelemetry(3600, { log }));
  assert.equal(warnings.length, 1);
  assert.deepEqual(await plainTelemetry(), { type: 'collection', timeseries: false, keys: { sourceId: 1, ts: 1 }, ttl: 3600 });
  const t = Date.now();
  await col.insertMany([7, 7, 3].map((sourceId, i) => ({ ts: new Date(t + i * 40), sourceId, seq: i + 1, warpFactor: 100 + i })));
  const found = await col.find({ sourceId: 7, ts: { $gte: new Date(t), $lt: new Date(t + 1000) } }).sort({ seq: 1 }).toArray();
  assert.deepEqual(found.map((d) => [d.seq, d.warpFactor]), [[1, 100], [2, 101]]);
});

test('a lost connection while creating telemetry is thrown, not taken for a refusal', async () => {
  await mongoose.connection.db.collection('telemetry').drop().catch(() => {});
  await withCreateCollection(new mongoose.mongo.MongoNetworkError('connection reset'), () => assert.rejects(ensureTelemetry(3600), mongoose.mongo.MongoNetworkError));
  assert.equal(await mongoose.connection.db.listCollections({ name: 'telemetry' }).next(), null);
});

test('TELEMETRY_TIMESERIES=0 makes telemetry plain, its expiry follows the setting, and an existing collection keeps its type', async () => {
  const saved = process.env.TELEMETRY_TIMESERIES;
  try {
    delete process.env.TELEMETRY_TIMESERIES;
    assert.equal(loadConfig().telemetryTimeseries, true);
    process.env.TELEMETRY_TIMESERIES = '0';
    assert.equal(loadConfig().telemetryTimeseries, false);
  } finally {
    saved === undefined ? delete process.env.TELEMETRY_TIMESERIES : (process.env.TELEMETRY_TIMESERIES = saved);
  }
  await mongoose.connection.db.collection('telemetry').drop().catch(() => {});
  await ensureTelemetry(3600, { timeseries: false });
  assert.deepEqual(await plainTelemetry(), { type: 'collection', timeseries: false, keys: { sourceId: 1, ts: 1 }, ttl: 3600 });
  await ensureTelemetry(7200);
  assert.deepEqual(await plainTelemetry(), { type: 'collection', timeseries: false, keys: { sourceId: 1, ts: 1 }, ttl: 7200 });
});

test('alerts get a TTL index, old alerts get createdAt from their time, and a changed setting updates the index', async () => {
  const old = { sourceId: 1, ts: 1_700_000_000_000, type: 'link-loss', severity: 'warn' };
  await mongoose.connection.db.collection('alerts').insertOne(old); // an alert saved before createdAt existed
  await ensureAlertsTtl(3600);
  assert.equal((await alertsIndex()).expireAfterSeconds, 3600);
  assert.equal((await mongoose.connection.db.collection('alerts').findOne({ type: 'link-loss' })).createdAt.getTime(), old.ts);
  await ensureAlertsTtl(86400);
  assert.equal((await alertsIndex()).expireAfterSeconds, 86400);
  const fresh = await Alert.create({ sourceId: 2, ts: Date.now(), type: 'core-temp', severity: 'warn' });
  assert.ok(Date.now() - fresh.createdAt.getTime() < 5000);
});
