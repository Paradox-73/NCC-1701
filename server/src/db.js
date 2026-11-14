import mongoose from 'mongoose';
import { Source, User, Device, Alert } from './models/index.js';

/**
 * Creates `telemetry` when missing and keeps its expiry at `ttlSec`; returns the native collection. New collections are
 * time series unless `timeseries` is false or the server refuses one (the free Atlas tier does not document support);
 * then a plain collection holds the same documents, with the index time series creates by itself plus a TTL index.
 * An existing collection keeps its type.
 */
export async function ensureTelemetry(ttlSec, { timeseries = true, log } = {}) {
  const db = mongoose.connection.db;
  const existing = await db.listCollections({ name: 'telemetry' }).next();
  if (existing?.options?.timeseries) {
    if (existing.options.expireAfterSeconds !== ttlSec) await db.command({ collMod: 'telemetry', expireAfterSeconds: ttlSec });
    return db.collection('telemetry');
  }
  if (!existing && timeseries) {
    try {
      await db.createCollection('telemetry', {
        timeseries: { timeField: 'ts', metaField: 'sourceId', granularity: 'seconds' },
        expireAfterSeconds: ttlSec,
      });
      return db.collection('telemetry');
    } catch (err) {
      if (!(err instanceof mongoose.mongo.MongoServerError)) throw err; // a lost connection is not a refusal
      log?.warn({ err: err.message }, 'time-series collection refused; telemetry goes to a plain collection with a TTL index');
    }
  }
  const telemetry = db.collection('telemetry');
  await telemetry.createIndex({ sourceId: 1, ts: 1 });
  await ensureTtlIndex(telemetry, 'ts', ttlSec);
  return telemetry;
}

/** Makes documents expire `ttlSec` after `field`; creates the index, or changes its expiry with collMod when it differs. */
async function ensureTtlIndex(col, field, ttlSec) {
  const name = `${field}_ttl`;
  const existing = (await col.indexes().catch(() => [])).find((i) => i.name === name);
  if (!existing) await col.createIndex({ [field]: 1 }, { name, expireAfterSeconds: ttlSec });
  else if (existing.expireAfterSeconds !== ttlSec) {
    await mongoose.connection.db.command({ collMod: col.collectionName, index: { name, expireAfterSeconds: ttlSec } });
  }
}

/** Makes alerts expire `ttlSec` after createdAt; alerts saved before createdAt existed get it from their ts. */
export async function ensureAlertsTtl(ttlSec) {
  const alerts = mongoose.connection.db.collection('alerts');
  await alerts.updateMany({ createdAt: { $exists: false }, ts: { $type: 'number' } }, [{ $set: { createdAt: { $toDate: '$ts' } } }]);
  await ensureTtlIndex(alerts, 'createdAt', ttlSec);
}

export async function connectDb(uri) {
  // the free Atlas tier allows 10 GB in per rolling 7 days; zlib sent 3.3x fewer bytes per sample in a local run
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, compressors: ['zlib'] });
  await Promise.all([Source, User, Device, Alert].map((m) => m.init()));
}

export const disconnectDb = () => mongoose.disconnect();
