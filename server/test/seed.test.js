import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { SOURCES, ROLES } from '@ncc/shared/schema.js';
import { Source, User } from '../src/models/index.js';
import { USERS, seed } from '../src/seed.js';

const URI = 'mongodb://127.0.0.1:27017/ncc_test_seed';
const log = { info: () => {} };

before(async () => {
  await mongoose.connect(URI);
  await mongoose.connection.dropDatabase();
  await Source.init();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('seeding brings an older sources collection up to the registry and adds the missing ones, once', async () => {
  await Source.insertMany([{ sourceId: 1, name: 'Old name', code: 'X-0' }]);
  await seed(log);
  const sources = await Source.find().sort({ sourceId: 1 }).lean();
  assert.deepEqual(sources.map((s) => [s.sourceId, s.name, s.code]), SOURCES.map((s) => [s.id, s.name, s.code]));
  await seed(log); // a restart changes nothing and adds no duplicates
  assert.equal(await Source.countDocuments(), SOURCES.length);
  assert.equal(await User.countDocuments(), USERS.length);
});

test('every registry role has a seeded user, so each one can sign in', () => {
  assert.deepEqual(USERS.map((u) => u.role).sort(), Object.keys(ROLES).sort());
});
