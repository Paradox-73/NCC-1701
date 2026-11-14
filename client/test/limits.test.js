import test from 'node:test';
import assert from 'node:assert/strict';
import { alarmOf, levelOf, limitsOf } from '../src/lib/limits.js';

test('alarmOf names a reading past its warn or critical limit and stays null while nominal or missing', () => {
  assert.equal(alarmOf('reactionRate', 64), null);
  assert.equal(alarmOf('reactionRate', 96), 'warn');
  assert.equal(alarmOf('reactionRate', 106), 'crit');
  assert.equal(alarmOf('shieldFore', 40), 'warn', 'a low-side limit counts too');
  assert.equal(alarmOf('shieldFore', 20), 'crit');
  assert.equal(alarmOf('shieldFore', undefined), null);
  assert.equal(alarmOf('noSuchChannel', 1e9), null);
  assert.equal(levelOf('shieldFore', 99), 'ok', 'levelOf keeps its own words for the shell');
});

test('limitsOf gives the rules of each side a channel has, for gauges and sparklines', () => {
  assert.deepEqual(Object.keys(limitsOf('reactionRate')), ['high']);
  assert.equal(limitsOf('reactionRate').high.critical, 105);
  assert.equal(limitsOf('shieldFore').low.warn, 50);
  assert.equal(limitsOf('noSuchChannel'), undefined);
});
