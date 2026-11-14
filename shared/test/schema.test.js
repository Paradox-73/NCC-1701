import assert from 'node:assert/strict';
import test from 'node:test';
import { CHANNELS, GROUPS, GROUP_CHANNELS, LIMITS, SAMPLE_LEN, canSeeGroup, checkPacked, packSample, unpackSample } from '../schema.js';

const values = () => Object.fromEntries(CHANNELS.map((c) => [c.key, (c.min + c.max) / 2]));
const NOW = 1_800_000_000_000;

test('pack and unpack round-trip every channel inside the scale resolution', () => {
  const v = values();
  const out = unpackSample(packSample(5, NOW, v));
  assert.equal(out.seq, 5);
  for (const c of CHANNELS) assert.ok(Math.abs(out[c.key] - v[c.key]) <= 0.5 / c.scale, c.key);
});

test('checkPacked accepts a good sample and names the first bad field', () => {
  const ok = packSample(1, NOW, values());
  assert.equal(checkPacked(ok, NOW), null);
  assert.equal(checkPacked(ok.slice(1), NOW), 'length');
  assert.equal(checkPacked([0, ...ok.slice(1)], NOW), 'seq');
  assert.equal(checkPacked([1, NOW + LIMITS.maxFutureMs + 1, ...ok.slice(2)], NOW), 'ts');
  const bad = ok.slice();
  bad[2 + CHANNELS.length - 1] = CHANNELS.at(-1).max * CHANNELS.at(-1).scale + 1;
  assert.equal(checkPacked(bad, NOW), CHANNELS.at(-1).key);
  assert.equal(ok.length, SAMPLE_LEN);
});

test('every channel belongs to a declared group and role access follows groups', () => {
  for (const c of CHANNELS) assert.ok(GROUPS.includes(c.group), c.key);
  assert.equal(Object.values(GROUP_CHANNELS).flat().length, CHANNELS.length);
  assert.ok(canSeeGroup('captain', 'warp'));
  assert.ok(!canSeeGroup('communications_officer', 'warp'));
  assert.ok(canSeeGroup('communications_officer', null));
  assert.ok(!canSeeGroup('nobody', 'warp'));
});
