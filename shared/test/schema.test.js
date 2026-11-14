import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHANNELS, CREW_SIZE, GROUPS, GROUP_CHANNELS, GROUP_KIND, KINDS, LIMITS, RULES, SOURCES, canSeeGroup, canSeeSource, channelsOf, checkPacked, crewHubOf, deckOfCrew,
  groupsOf, kindOf, packSample, roleMayCommand, sampleLen, stardate, unpackSample, CHANNEL_BY_KEY, ROLES,
} from '../schema.js';

const values = (id) => Object.fromEntries(channelsOf(id).map((c) => [c.key, (c.min + c.max) / 2]));
const NOW = 1_800_000_000_000;

test('the ship kind has 121 channels, the crew kind four vitals for each of 430 crew', () => {
  assert.equal(KINDS.ship.channels.length, 121);
  assert.equal(KINDS.crew.channels.length, CREW_SIZE * 4);
  assert.equal(CHANNELS.length, 121 + 1720);
  assert.equal(new Set(CHANNELS.map((c) => c.key)).size, CHANNELS.length, 'keys never repeat across kinds');
  const perDeck = {};
  for (let n = 1; n <= CREW_SIZE; n++) perDeck[deckOfCrew(n)] = (perDeck[deckOfCrew(n)] ?? 0) + 1;
  assert.deepEqual(Object.values(perDeck), [12, ...Array(11).fill(38)]);
});

test('pack and unpack round-trip every channel of both kinds inside the scale resolution', () => {
  for (const id of [1, 11]) {
    const v = values(id);
    const packed = packSample(5, NOW, v, id);
    assert.equal(packed.length, sampleLen(id));
    const out = unpackSample(packed, id);
    assert.equal(out.seq, 5);
    for (const c of channelsOf(id)) assert.ok(Math.abs(out[c.key] - v[c.key]) <= 0.5 / c.scale, c.key);
  }
});

test('checkPacked checks the length of the source kind and names the first bad field', () => {
  const ok = packSample(1, NOW, values(1), 1);
  assert.equal(checkPacked(ok, NOW, 1), null);
  assert.equal(checkPacked(ok, NOW, 11), 'length', 'a ship sample is not a crew sample');
  assert.equal(checkPacked(ok.slice(1), NOW, 1), 'length');
  assert.equal(checkPacked([0, ...ok.slice(1)], NOW, 1), 'seq');
  assert.equal(checkPacked([1, NOW + LIMITS.maxFutureMs + 1, ...ok.slice(2)], NOW, 1), 'ts');
  const bad = ok.slice();
  bad[2 + channelsOf(1).findIndex((c) => c.key === 'o2_01')] = -500; // o2_01 = -5 %, the forged reading in Space Seed
  assert.equal(checkPacked(bad, NOW, 1), 'o2_01');
  const crew = packSample(1, NOW, values(11), 11);
  assert.equal(checkPacked(crew, NOW, 11), null);
});

test('every channel belongs to a group of its own kind, and sources map to kinds', () => {
  for (const [kind, k] of Object.entries(KINDS)) for (const c of k.channels) assert.equal(GROUP_KIND[c.group], kind, c.key);
  assert.equal(Object.values(GROUP_CHANNELS).flat().length, CHANNELS.length);
  assert.equal(GROUPS.length, 13 + 12);
  assert.deepEqual(SOURCES.map((s) => [s.id, kindOf(s.id)]), [[1, 'ship'], [2, 'ship'], [3, 'ship'], [4, 'ship'], [11, 'crew'], [12, 'crew'], [13, 'crew'], [14, 'crew']]);
  assert.equal(kindOf(60), 'ship', 'an unregistered id is a ship (load test sources)');
  assert.equal(crewHubOf(1), 11);
  assert.ok(groupsOf(11).every((g) => g.startsWith('bio-d')));
});

test('role access follows groups and ships; biosigns belong to the captain and the chief medical officer only', () => {
  assert.ok(canSeeGroup('captain', 'warp'));
  assert.ok(!canSeeGroup('communications_officer', 'warp'));
  assert.ok(canSeeGroup('communications_officer', null));
  assert.ok(!canSeeGroup('nobody', 'warp'));
  const bioRoles = Object.keys(ROLES).filter((r) => ROLES[r].groups.some((g) => g.startsWith('bio-')));
  assert.deepEqual(bioRoles.sort(), ['captain', 'chief_medical_officer']);
  assert.ok(!canSeeGroup('starfleet_command', 'bio-d07'));
  assert.ok(canSeeSource('starfleet_command', 3) && !canSeeSource('captain', 3));
  assert.ok(canSeeSource('chief_medical_officer', 11) && !canSeeSource('chief_engineer', 11));
  assert.ok(canSeeSource('starfleet_command', 40) && !canSeeSource('captain', 40), 'a source outside the registry is for admins');
});

test('command permissions: families by pattern, single commands exactly', () => {
  assert.ok(roleMayCommand('captain', 'helm.warp') && roleMayCommand('captain', 'scenario.start'));
  assert.ok(!roleMayCommand('captain', 'sim.fault'));
  assert.ok(roleMayCommand('chief_engineer', 'engineering.allocate') && roleMayCommand('chief_engineer', 'transporter.energize'));
  assert.ok(!roleMayCommand('chief_engineer', 'tactical.phasers'));
  assert.ok(!roleMayCommand('communications_officer', 'tactical.phasers') && roleMayCommand('communications_officer', 'comms.hail'));
  assert.ok(roleMayCommand('starfleet_command', 'sim.fault') && roleMayCommand('starfleet_command', 'scenario.stop'));
  assert.ok(roleMayCommand('science_officer', 'science.scan') && !roleMayCommand('science_officer', 'science.scanx'));
});

test('every rule and z-score channel names a real channel, and the nominal of every channel lies in its range', () => {
  for (const r of RULES.thresholds) assert.ok(CHANNEL_BY_KEY[r.channel], r.channel);
  for (const k of RULES.zChannels) assert.ok(CHANNEL_BY_KEY[k], k);
  for (const c of CHANNELS) assert.ok(c.nominal >= c.min && c.nominal <= c.max, c.key);
  for (const r of RULES.thresholds) assert.ok(r.dir === 'high' ? r.critical > r.warn : r.critical < r.warn, `${r.type} ${r.channel}: critical lies beyond warn`);
});

test('every nominal channel value sits clear of its own alert limits, so calm running is silent', () => {
  for (const r of RULES.thresholds) {
    const v = CHANNEL_BY_KEY[r.channel].nominal;
    assert.ok(r.dir === 'high' ? v <= r.warn : v >= r.warn, `${r.channel} nominal ${v} against ${r.type}`);
  }
});

test('the stardate runs ten units a day from 1 Jan 2026', () => {
  assert.equal(stardate(Date.UTC(2026, 0, 1)), 1000);
  assert.equal(Math.round(stardate(Date.UTC(2026, 0, 2)) - 1000), 10);
  assert.ok(Math.abs(stardate(Date.UTC(2026, 10, 14)) - 4170) < 20);
  assert.ok(Math.abs((71 * 3600e3) / 8_640_000 - 29.6) < 0.05, '71 hours is 29.6 stardate units');
});
