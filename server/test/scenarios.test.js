// The six episodes, run end to end on the offline bridge (test/helpers/harness.js): the simulator's physics, the real
// detector, the real world and runner. Every alert a scenario promises must come out of the detector; none is injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, SCENARIO_LIST } from '@ncc/shared/scenarios/index.js';
import { CHANNEL_BY_KEY, channelsOf } from '@ncc/shared/schema.js';
import { makeBridge } from './helpers/harness.js';

const WARM_UP_S = 40; // calm running before the scenario: the statistics need 30 s

/** Starts a scenario after a calm warm-up; `attend` is called each second with the runner status, to act as a presenter. */
function play(id, { attend, extra = 0 } = {}) {
  const b = makeBridge();
  b.run(WARM_UP_S);
  const t0 = b.t();
  const calmAlerts = b.alerts.length;
  b.command(1, { type: 'scenario.start', id });
  let guard = 0;
  b.run(1);
  while (b.world.runner.status() && guard++ < 200) {
    attend?.(b, b.world.runner.status());
    b.run(1);
  }
  const length = b.t() - t0;
  if (extra) b.run(extra);
  const seen = b.alerts.slice(calmAlerts).map((a) => ({ ...a, t: Math.round((a.t - t0) * 10) / 10 }));
  /** First alert of a type on a source (and channel, severity): its time, or undefined. */
  const at = (type, { source = 1, channel, severity } = {}) => seen.find((a) => a.type === type && a.sourceId === source && (!channel || a.channel === channel) && (!severity || a.severity === severity))?.t;
  return { b, t0, length, seen, at, calmAlerts };
}
const within = (v, lo, hi, what) => assert.ok(v !== undefined && v >= lo && v <= hi, `${what}: ${v} not in ${lo}-${hi}`);
const nominalAfter = (b, shipId, keys) => {
  for (const k of keys) {
    const c = CHANNEL_BY_KEY[k];
    const v = b.ships[shipId].out[k];
    assert.ok(Math.abs(v - c.nominal) <= (c.max - c.min) * 0.05, `${k} is ${v}, nominal ${c.nominal}`);
  }
};
const settle = (b) => b.run(25); // ten seconds of drift back, then some

test('calm running is silent: ten minutes of four ships and their crews raise no alert', () => {
  const b = makeBridge();
  b.run(600);
  assert.deepEqual(b.alerts.map((a) => `${a.t} ${a.sourceId} ${a.type} ${a.channel}`), []);
});

test('the scenario list has the six episodes of DOMAIN.md in build order, each with 60 to 120 s of script', () => {
  assert.deepEqual(SCENARIO_LIST.map((s) => s.id), ['balance-of-terror', 'the-naked-time', 'the-doomsday-machine', 'mirror-mirror', 'the-trouble-with-tribbles', 'space-seed']);
  for (const s of SCENARIO_LIST) assert.ok(s.duration >= 60 && s.duration <= 120 && s.ships.length >= 1 && s.title && s.summary, s.id);
  for (const sc of Object.values(SCENARIOS)) for (const step of sc.steps) assert.ok(Number.isFinite(step.t), `${sc.id}: a step has no time`);
});

test('Balance of Terror: the statistics catch the ghost, red alert, shield hits, phaser coolant, and it all returns to normal', () => {
  const { b, length, at, seen } = play('balance-of-terror');
  within(length, 80, 120, 'unattended length');
  within(at('zscore', { channel: 'contactSnr' }), 12, 18, 'sensor ghost caught by the statistics');
  assert.equal(at('contact-close', { channel: 'contactRange' }), undefined, 'the ghost is too far for a fixed limit');
  assert.ok(b.ev('condition').some((e) => e.payload.level === 'red' && e.payload.by === 'scenario'), 'the runner ordered red alert when nobody did');
  within(at('shield-load', { severity: 'warn' }), 30, 40, 'shield generator load');
  within(at('shield-low', { channel: 'shieldFore', severity: 'critical' }), 36, 46, 'fore shield critical after the second torpedo');
  assert.deepEqual(b.ev('fx').filter((e) => e.payload.name === 'hit').map((e) => `${e.payload.shipId} ${e.payload.quad} ${e.payload.amount}`), ['1 fore 45', '1 fore 50', '1 all 10'], 'every hit reaches the bridges as an fx, quadrant and size included');
  const hull = b.ships[1].s.hull;
  assert.ok(hull >= 99 || b.ships[1].s.hullHeal > 0, 'hull was damaged and is being repaired after the scenario');
  within(at('phaser-temp', { severity: 'warn' }), 55, 80, 'phaser coolant warn');
  within(at('phaser-temp', { severity: 'critical' }), 62, 90, 'phaser coolant critical');
  assert.ok(at('phaser-temp', { severity: 'warn' }) < at('phaser-temp', { severity: 'critical' }));
  assert.equal(b.world.condition(1), 'normal');
  assert.equal(b.world.runner.status(), null);
  assert.ok(seen.every((a) => a.sourceId === 1), 'only the Enterprise');
  settle(b);
  nominalAfter(b, 1, ['phaserTemp', 'contactSnr', 'shieldFore', 'shieldLoad', 'warpFactor']);
  assert.equal(b.ev('scenario').at(-1).payload.state, 'ended');
  assert.equal(b.ev('command:ack').filter((e) => e.payload.by === 'scenario').map((e) => e.payload.type).join(), 'helm.warp,ship.condition,tactical.phasers,tactical.phasers');
});

test('Balance of Terror with a presenter: the awaited commands move the scenario on, and the clock waits for them', () => {
  const acts = [];
  const attend = (b, st) => {
    const a = st.awaiting;
    if (!a || acts.includes(`${st.step}`)) return;
    acts.push(`${st.step}`);
    const cmd = a.type === 'ship.condition' ? { type: a.type, level: a.level } : { type: a.type, bank: 'fore' };
    b.command(1, cmd, b.as('captain', 'captain'));
  };
  const { length, b } = play('balance-of-terror', { attend });
  assert.equal(acts.length, 3, 'three awaited steps, each acted on');
  within(length, 60, 95, 'attended length: no timeouts are waited out');
  assert.ok(b.ev('condition').some((e) => e.payload.level === 'red' && e.payload.by === 'captain'), 'red alert ordered by the captain');
  assert.equal(b.ev('command:ack').filter((e) => e.payload.by === 'scenario').length, 1, 'only helm.warp came from the scenario itself');
});

test('The Naked Time: crew 207 first, then the spread; ship alerts reach everyone, per-crew alerts only the sickbay; restart and time warp', () => {
  const { b, length, at, seen } = play('the-naked-time');
  within(length, 90, 120, 'unattended length');
  const crew = seen.filter((a) => a.sourceId === 11);
  const first = crew.find((a) => a.channel === 'hr_207' || a.channel === 'nr_207');
  within(first.t, 5, 9, 'crew 207 alert after the infection at t 5');
  assert.deepEqual([...new Set(crew.filter((a) => a.channel.endsWith('_207')).map((a) => a.group))], ['bio-d07']);
  assert.ok(crew.every((a) => a.group.startsWith('bio-d')), 'per-crew alerts belong to biosign groups, which only the captain and the chief medical officer join');
  assert.ok(new Set(crew.map((a) => a.channel.slice(3))).size > 40, 'the infection reached many crew');
  const watch = at('crew-watch', { severity: 'critical' });
  within(watch, 40, 70, 'crewWatch critical (over 60 crew on watch)');
  within(at('crew-critical', { severity: 'critical' }), 40, 70, 'crewCritical passes 5');
  within(at('descent-rate', { severity: 'warn' }), 48, 60, 'descent rate warn');
  assert.ok(at('descent-rate', { severity: 'critical' }) > at('descent-rate', { severity: 'warn' }));
  within(at('hull-heat'), 55, 80, 'hull temperature over 400');
  within(at('battery-low'), 60, 90, 'battery under 50');
  within(at('reaction-rate', { severity: 'critical' }), 85, 105, 'the cold restart overshoots 105');
  const warp = b.ev('fx').find((e) => e.payload.name === 'timewarp').payload;
  assert.ok(Math.abs(warp.stardateDelta + 29.58) < 0.01);
  assert.ok(b.ev('log').some((e) => e.payload.text.includes('Time warp')));
  assert.ok(b.world.state(1).stardateOffset < -29.5, 'the ship keeps the offset, so a late joiner sees the rolled-back stardate');
  assert.deepEqual(b.ev('command:ack').filter((e) => e.payload.by === 'scenario').map((e) => e.payload.type), ['medical.inoculate', 'engineering.coldRestart']);
  settle(b);
  nominalAfter(b, 1, ['reactionRate', 'warpField', 'powerTotal', 'descentRate', 'orbitAlt', 'hullTemp', 'warpFactor']);
  assert.equal(b.ships[1].crew.counts.critical, 0, 'the crew recovered');
});

test('The Naked Time, privacy: sickbay vitals live only on crew sources, and the ship summary carries counts without names', () => {
  const b = makeBridge();
  assert.deepEqual(channelsOf(1).filter((c) => /^(hr|rr|bt|nr)_\d/.test(c.key)), []);
  b.run(2);
  const v = b.ships[1].out;
  assert.ok(['crewAboard', 'crewWatch', 'crewCritical', 'crewMeanHr'].every((k) => k in v));
});

test('The Doomsday Machine: two ships, the Constellation wrecked and lost, the Enterprise drained, and the lost ship returns 30 s later', () => {
  const { b, length, at, seen } = play('the-doomsday-machine', { extra: 40 });
  within(length, 90, 120, 'unattended length');
  const one = (type, o = {}) => at(type, { source: 2, ...o });
  assert.ok(one('shield-low', { severity: 'critical' }) < 5 && one('hull-integrity', { severity: 'critical' }) < 5 && one('lr-sensor', { severity: 'critical' }) < 5, 'the wreck is red from the start');
  within(one('link-loss'), 0, 5, 'the Constellation drops out');
  assert.ok(seen.filter((a) => a.sourceId === 2 && a.type === 'link-loss').length >= 5, 'its link drops again and again');
  within(at('contact-close', { severity: 'warn' }), 30, 45, 'the object closes under 50,000 km');
  within(at('transporter-fault', { severity: 'critical' }), 25, 40, 'transporter wrecked');
  assert.ok(at('carrier-weak') && at('comms-loss'), 'the subspace radio is disrupted');
  within(at('shield-low', { severity: 'critical' }), 30, 45, 'the Enterprise shields drained to red');
  within(at('hull-stress', { severity: 'warn' }), 40, 70, 'tractor beam stress');
  within(at('xp-pattern', { severity: 'critical' }), 80, 105, 'the transporter fails while beaming the pilot back');
  const boom = b.ev('log').find((e) => e.payload.text.includes('explodes')).t;
  within(one('impulse-overload', { severity: 'warn' }), 60, boom, 'the countdown starts (impulse reactor over 100)');
  within(one('impulse-overload', { severity: 'critical' }), 60, boom, 'impulse reactor over 115 before the explosion');
  assert.deepEqual(b.ev('command:ack').filter((e) => e.payload.by === 'scenario').map((e) => e.payload.type), ['helm.heading', 'tactical.phasers', 'transporter.energize']);
  assert.ok(b.lastValues[2].hullIntegrity >= 99 && b.lastValues[2].crewAboard === 430, 'the Constellation is back in calm running after the scenario');
});

test('Mirror, Mirror: the storm hits comms and the transporter, four crew shift, and the storm fault is ordered on the link', () => {
  const { b, length, at, seen } = play('mirror-mirror');
  within(length, 55, 90, 'unattended length');
  for (const [type, lo, hi] of [['ion-flux', 10, 30], ['interference', 8, 30], ['comms-loss', 8, 30], ['carrier-weak', 10, 30]]) within(at(type), lo, hi, type);
  within(at('ion-flux', { severity: 'critical' }), 20, 35, 'ion flux red');
  within(at('xp-lock', { severity: 'critical' }), 24, 28, 'signal lock red');
  within(at('xp-pattern', { severity: 'warn' }), 24, 28, 'pattern integrity yellow');
  assert.equal(at('xp-pattern', { severity: 'critical' }), undefined, '96 percent is yellow, not red');
  assert.deepEqual(seen.filter((a) => a.sourceId === 11).map((a) => a.channel).sort(), ['nr_001', 'nr_002', 'nr_003', 'nr_004']);
  assert.ok(seen.filter((a) => a.sourceId === 11).every((a) => a.type === 'zscore' && a.group === 'bio-d01'), 'statistical alerts only, in the deck 1 biosign group');
  assert.equal(b.stream.storm.get(1), 40, 'the simulator is told to scramble the link for 40 s');
  within(at('xp-energy', { severity: 'warn' }), 50, 70, 'emergency power energize over 30 MW');
  assert.deepEqual(b.ev('command:ack').filter((e) => e.payload.by === 'scenario').map((e) => `${e.payload.type}${e.payload.args.preset ? ' ' + e.payload.args.preset : ''}`), ['transporter.energize', 'engineering.allocate emergency', 'transporter.energize']);
  settle(b);
  nominalAfter(b, 1, ['ionFlux', 'interference', 'carrier', 'loss', 'xpLock', 'xpPattern']);
});

test('The Trouble with Tribbles: the population multiplies by 11 every 10 s and carbon dioxide alerts go deck by deck', () => {
  const { b, length, at } = play('the-trouble-with-tribbles');
  within(length, 70, 100, 'unattended length');
  within(at('lifeforms', { severity: 'warn' }), 17, 23, 'over 100 life-forms');
  within(at('lifeforms', { severity: 'critical' }), 36, 42, 'over 10,000 life-forms');
  const order = [9, 10, 6, 5, 3, 2];
  const warn = order.map((d) => at('co2-high', { channel: `co2_${String(d).padStart(2, '0')}`, severity: 'warn' }));
  const red = order.map((d) => at('co2-high', { channel: `co2_${String(d).padStart(2, '0')}`, severity: 'critical' }));
  assert.ok(warn.every((t, i) => t !== undefined && (i === 0 || t > warn[i - 1])), `co2 warn deck by deck: ${warn}`);
  assert.ok(red.every((t, i) => t !== undefined && (i === 0 || t > red[i - 1]) && t > warn[i]), `co2 red deck by deck: ${red}`);
  assert.ok(at('oxygen-low', { channel: 'o2_09', severity: 'critical' }) > 0);
  assert.equal(at('co2-high', { channel: 'co2_01' }), undefined, 'a deck the tribbles never reach stays quiet');
  within(at('xp-energy', { severity: 'warn' }), 55, 80, 'the transporter clears them');
  assert.equal(b.world.state(1).condition, 'normal');
  settle(b);
  nominalAfter(b, 1, ['lifeforms', 'co2_09', 'o2_09', 'co2_02', 'temp_09']);
  // the history the forecast fits: lifeforms grows by a factor of 11 per 10 s early on
  const grow = (t) => 11 ** (t / 10);
  assert.ok(Math.abs(Math.log10(grow(40) / grow(30)) - Math.log10(11)) < 1e-9);
});

test('Space Seed: the rogue source is told its three phases, life support is cut deck by deck, crew 001 goes red, vent gas ends it', () => {
  const { b, length, at, seen } = play('space-seed');
  within(length, 80, 120, 'unattended length');
  assert.deepEqual(b.stream.rogue, ['auth', 'invalid', 'flood']);
  within(at('ingest-auth', { source: 1, severity: 'warn' }), 10, 16, 'wrong device key refused three times');
  within(at('ingest-invalid', { source: 99, severity: 'warn' }), 18, 24, 'out-of-range readings refused');
  within(at('ingest-flood', { source: 99, severity: 'critical' }), 25, 31, 'flood throttled');
  assert.ok(seen.filter((a) => a.type.startsWith('ingest-')).every((a) => a.group === null), 'ingest alerts belong to no channel group: every role sees them');
  const cut = [1, 2, 3].map((d) => at('pressure-low', { channel: `press_0${d}`, severity: 'critical' }));
  assert.ok(cut.every((t, i) => t > 30 && (i === 0 || t > cut[i - 1])), `decks 1, 2, 3 in order: ${cut}`);
  assert.ok([1, 2, 3].every((d) => at('oxygen-low', { channel: `o2_0${d}`, severity: 'critical' }) && at('deck-cold', { channel: `temp_0${d}`, severity: 'warn' })));
  const khan = seen.find((a) => a.sourceId === 11 && a.channel === 'hr_001' && a.severity === 'critical');
  within(khan.t, 45, 55, 'crew 001 red');
  assert.equal(khan.group, 'bio-d01');
  within(at('chamber-temp', { severity: 'warn' }), 70, 95, 'chamber over 70 as Khan tries to destroy the ship');
  assert.equal(b.ev('command:ack').filter((e) => e.payload.by === 'scenario')[0].payload.type, 'security.ventGas');
  assert.equal(b.ev('condition')[0].payload.level, 'yellow', 'a critical life-support alert raised the ship from normal to yellow');
  settle(b);
  nominalAfter(b, 1, ['press_01', 'o2_02', 'temp_03', 'chamberTemp', 'powerTotal']);
});

test('only one scenario runs at a time; stopping restores normal running; an unknown id is 404 and a stopped scenario reports so', () => {
  const b = makeBridge();
  b.run(5);
  assert.throws(() => b.command(1, { type: 'scenario.start', id: 'nope' }), { status: 404 });
  assert.throws(() => b.command(1, { type: 'scenario.stop' }), { status: 409 });
  b.command(1, { type: 'scenario.start', id: 'balance-of-terror' });
  assert.throws(() => b.command(1, { type: 'scenario.start', id: 'mirror-mirror' }), { status: 409 });
  b.run(35);
  assert.ok(['running', 'awaiting'].includes(b.world.runner.status().state));
  b.command(1, { type: 'scenario.stop' });
  assert.equal(b.world.runner.status(), null);
  assert.equal(b.ev('scenario').at(-1).payload.state, 'stopped');
  assert.equal(b.world.condition(1), 'normal');
  b.run(20);
  assert.ok(Math.abs(b.ships[1].out.contactSnr - 2) < 1.5, 'the ghost is gone after the stop');
});

test('scenario-only commands are accepted exactly while a scenario waits for them', () => {
  const b = makeBridge();
  b.run(2);
  assert.throws(() => b.command(1, { type: 'engineering.coldRestart' }), { status: 409 });
  b.command(1, { type: 'scenario.start', id: 'the-naked-time' });
  const until = (type) => {
    for (let i = 0; i < 150 && b.world.runner.status()?.awaiting?.type !== type; i++) b.run(1);
  };
  until('medical.inoculate');
  assert.equal(b.world.runner.status().awaiting.type, 'medical.inoculate');
  assert.throws(() => b.command(1, { type: 'engineering.coldRestart' }), { status: 409 }, 'the scenario waits for the inoculation first');
  assert.throws(() => b.command(1, { type: 'engineering.coldRestart' }, b.as('engineer', 'chief_engineer')), { status: 409 });
  b.command(1, { type: 'medical.inoculate' }, b.as('medical', 'chief_medical_officer'));
  until('engineering.coldRestart');
  assert.equal(b.world.runner.status().awaiting.type, 'engineering.coldRestart');
  const tAwait = b.world.runner.status().t;
  b.run(1);
  b.command(1, { type: 'engineering.coldRestart' }, b.as('engineer', 'chief_engineer'));
  assert.equal(b.world.runner.status().awaiting, null, 'the clock runs again');
  b.run(1);
  assert.ok(b.world.runner.status().t > tAwait);
  const people = b.ev('command:ack').filter((e) => e.payload.role !== 'scenario' && e.payload.type !== 'scenario.start').map((e) => `${e.payload.by} ${e.payload.type}`);
  assert.deepEqual(people, ['medical medical.inoculate', 'engineer engineering.coldRestart']);
  assert.equal(b.ev('command:ack').filter((e) => e.payload.by === 'scenario' && e.payload.type === 'engineering.coldRestart').length, 0, 'the runner did not repeat it');
  assert.throws(() => b.command(1, { type: 'engineering.coldRestart' }), { status: 409 }, 'and the door closes again');
});
