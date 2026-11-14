import bcrypt from 'bcryptjs';
import { SOURCES } from '@ncc/shared/schema.js';
import { Source, User } from './models/index.js';

// Demo accounts, one per role in shared/registry.js. The login screen has a button for each; written when the users collection is empty.
export const USERS = [
  { username: 'captain', password: 'ncc-captain', role: 'captain' },
  { username: 'engineer', password: 'ncc-engineer', role: 'chief_engineer' },
  { username: 'medical', password: 'ncc-medical', role: 'chief_medical_officer' },
  { username: 'science', password: 'ncc-science', role: 'science_officer' },
  { username: 'comms', password: 'ncc-comms', role: 'communications_officer' },
  { username: 'command', password: 'ncc-command', role: 'starfleet_command' },
];

/** Writes every registry source (inserted, or brought up to date) and the users when there are none. */
export async function seed(log) {
  const sources = await Source.bulkWrite(
    SOURCES.map((s) => ({ updateOne: { filter: { sourceId: s.id }, update: { $set: { name: s.name, code: s.code } }, upsert: true } })),
  );
  if (sources.upsertedCount || sources.modifiedCount) log.info({ added: sources.upsertedCount, updated: sources.modifiedCount }, 'seeded sources');
  if ((await User.countDocuments()) === 0) {
    await User.insertMany(USERS.map(({ password, ...u }) => ({ ...u, passwordHash: bcrypt.hashSync(password, 10) })));
    log.info('seeded users');
  }
}
