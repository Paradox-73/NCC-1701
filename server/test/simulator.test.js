// The simulator's physics, crew model and stream faults, without a server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { channelsOf, checkPacked, packSample } from '@ncc/shared/schema.js';
import { Ship } from '../../simulator/src/physics.js';
import { dueFrom, scramble, storm } from '../../simulator/src/index.js';

const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const T0 = 1_800_000_000_000;
function run(ship, seconds, hz = 50) {
  let v;
  for (let i = 0; i < Math.round(seconds * hz); i++) v = ship.step(1 / hz, T0 + ship.t * 1000);
  return v;
}

test('every simulated sample, in every state a scenario reaches, is valid on the wire', () => {
  const ship = new Ship(1, { rand: lcg(1) });
  const states = [
    (s) => s.command({ type: 'helm.warp', args: { factor: 9 } }),
    (s) => s.command({ type: 'ship.condition', args: { level: 'red' } }),
    (s) => s.command({ type: 'scn.hit', args: { quad: 'all', amount: 500, hull: 500 } }),
    (s) => s.command({ type: 'scn.ramp', args: { ch: 'lifeforms', to: 99_999_999, over: 1 } }),
    (s) => s.command({ type: 'scn.ramp', args: { ch: 'descentRate', to: -9999, over: 1 } }),
    (s) => s.command({ type: 'scn.noise', args: { ch: 'carrier', sigma: 500 } }),
    (s) => s.command({ type: 'scn.crew', args: { infect: Array.from({ length: 430 }, (_, i) => i + 1) } }),
  ];
  let seq = 1;
  for (const apply of states) {
    apply(ship);
    for (let i = 0; i < 400; i++) {
      const ts = T0 + seq * 20;
      assert.equal(checkPacked(packSample(seq++, ts, ship.step(0.02, ts), 1), ts, 1), null);
    }
  }
});

test('warp factor drives the core: reaction rate, chamber temperature, nacelles, power and speed follow the order with their time constants', () => {
  const ship = new Ship(1, { rand: lcg(2) });
  const calm = run(ship, 10);
  assert.ok(Math.abs(calm.warpFactor - 6) < 0.1 && Math.abs(calm.reactionRate - 64) < 2 && Math.abs(calm.chamberTemp - 44) < 1 && Math.abs(calm.speed - 216) < 1);
  ship.command({ type: 'helm.warp', args: { factor: 8 } });
  const early = run(ship, 1);
  assert.ok(early.warpFactor > 6 && early.warpFactor < 7.6, 'warp follows its order with a 2 s time constant');
  const later = run(ship, 25);
  assert.ok(Math.abs(later.warpFactor - 8) < 0.1);
  assert.ok(Math.abs(later.reactionRate - 82) < 2, `reaction ${later.reactionRate}`);
  assert.ok(Math.abs(later.nacellePort - 80.4) < 3 && Math.abs(later.nacelleStbd - later.nacellePort) < 5);
  assert.ok(Math.abs(later.chamberTemp - 52) < 1.5 && Math.abs(later.dilithiumTemp - 770) < 12);
  assert.ok(Math.abs(later.speed - 512) < 8 && Math.abs(later.powerTotal - 96) < 2);
  ship.command({ type: 'helm.warp', args: { factor: 0 } });
  const drop = run(ship, 20);
  assert.equal(drop.warpFactor, 0);
  assert.ok(drop.impulse > 15 && drop.impulse < 25, 'dropping out of warp leaves the ship on impulse');
  assert.ok(drop.speed < 1 && drop.reactionRate < 15);
});

test('above warp 8 the dilithium crystals tire and the stress rises; below it they recover', () => {
  const ship = new Ship(1, { rand: lcg(3) });
  ship.command({ type: 'helm.warp', args: { factor: 9 } });
  const hot = { ...run(ship, 120) };
  assert.ok(hot.dilithiumEff < 97.5 && hot.dilithiumEff > 90, `crystal ${hot.dilithiumEff}`);
  assert.ok(hot.hullStress > 11);
  ship.command({ type: 'helm.warp', args: { factor: 6 } });
  assert.ok(run(ship, 120).dilithiumEff > hot.dilithiumEff);
});

test('heading turns toward the order at 3 degrees a second by the short way, and the ship moves along it at speed / 400 su a second', () => {
  const ship = new Ship(1, { rand: lcg(4) });
  ship.command({ type: 'helm.heading', args: { deg: 350 } });
  const v = run(ship, 10);
  assert.ok(Math.abs(v.heading - 60) < 1, `from 90 to 350 is 110 degrees the short way: 30 degrees in 10 s, heading ${v.heading}`);
  const ship2 = new Ship(1, { rand: lcg(4) });
  const p0 = { ...run(ship2, 1) };
  const p1 = run(ship2, 60);
  assert.ok(Math.abs(p1.posX - p0.posX - 0.54 * 60) < 1.5 && Math.abs(p1.posY - p0.posY) < 0.5, `moved ${p1.posX - p0.posX}`);
  ship2.command({ type: 'helm.heading', args: { delta: -90 } });
  assert.equal(ship2.order.heading, 0);
});

test('shields: a hit with shields up costs the quadrant and loads the generator, then recharges 2 percent a second; with shields down the hull takes it', () => {
  const down = new Ship(1, { rand: lcg(5) });
  run(down, 5);
  down.command({ type: 'scn.hit', args: { quad: 'fore', amount: 40 } });
  const d = run(down, 0.1);
  assert.ok(d.hullIntegrity < 85 && d.shieldFore > 98, `shields were down: the hit went to the hull (${d.hullIntegrity})`);
  const s = new Ship(1, { rand: lcg(6) });
  s.command({ type: 'ship.condition', args: { level: 'yellow' } });
  run(s, 20);
  s.command({ type: 'scn.hit', args: { quad: 'aft', amount: 45 } });
  const a = { ...run(s, 0.1) };
  assert.ok(Math.abs(a.shieldAft - 55.2) < 1 && a.shieldFore > 98 && a.hullIntegrity === 100);
  assert.ok(a.shieldLoad > 70, `generator load ${a.shieldLoad}`);
  const b = run(s, 10);
  assert.ok(Math.abs(b.shieldAft - 75.2) < 1.5, `recharged to ${b.shieldAft}`);
  assert.ok(b.shieldLoad < a.shieldLoad);
  assert.equal(b.shieldsUp, 1);
});

test('conditions: yellow raises shields, red also switches power to COMBAT, normal brings back CRUISE', () => {
  const ship = new Ship(1, { rand: lcg(7) });
  run(ship, 6);
  assert.deepEqual([ship.out.shieldsUp, Math.round(ship.out.allocShields)], [0, 15]);
  ship.command({ type: 'ship.condition', args: { level: 'yellow' } });
  assert.equal(run(ship, 1).shieldsUp, 1);
  ship.command({ type: 'ship.condition', args: { level: 'red' } });
  const red = run(ship, 8);
  assert.deepEqual([Math.round(red.allocWarp), Math.round(red.allocShields), Math.round(red.allocWeapons), Math.round(red.allocLife)], [30, 35, 25, 10]);
  ship.command({ type: 'ship.condition', args: { level: 'normal' } });
  const calm = run(ship, 8);
  assert.deepEqual([calm.shieldsUp, Math.round(calm.allocWarp)], [0, 55]);
  ship.command({ type: 'engineering.allocate', args: { preset: 'emergency' } });
  assert.equal(Math.round(run(ship, 8).allocLife), 40);
});

test('phasers cost 40 percent of a bank, heat the coolant 12 degrees, wait a second between shots; torpedoes need a loaded tube and reload in 4 s', () => {
  const ship = new Ship(1, { rand: lcg(8) });
  run(ship, 1);
  assert.equal(ship.firePhasers('fore'), true);
  assert.equal(ship.firePhasers('fore'), false, '1 s cooldown');
  const v = run(ship, 1);
  assert.ok(v.phaserFore < 70 && v.phaserFore > 60 && v.phaserAft === 100 && v.phaserTemp > 38);
  assert.equal(ship.firePhasers('aft'), true);
  assert.equal(ship.fireTorpedo(), true);
  assert.equal(ship.fireTorpedo(), true);
  assert.equal(ship.fireTorpedo(), false, 'both tubes are empty');
  assert.equal(run(ship, 0.1).tubesLoaded, 0);
  const later = run(ship, 5);
  assert.deepEqual([later.torpedoes, later.tubesLoaded], [22, 1]);
  assert.ok(run(ship, 60).phaserTemp < 33, 'the coolant cools with a 20 s time constant');
});

test('the transporter runs a cycle: energizing, transporting, idle, drawing about 18 MW; a second request mid-cycle is refused', () => {
  const ship = new Ship(1, { rand: lcg(9) });
  run(ship, 1);
  assert.equal(ship.energize(), true);
  assert.equal(ship.energize(), false);
  const states = [];
  for (let i = 0; i < 6 * 50; i++) {
    const v = ship.step(0.02, T0 + i * 20);
    if (!states.length || states.at(-1) !== v.xpState) states.push(v.xpState);
    if (v.xpState === 2 && i > 3 * 50) assert.ok(v.xpEnergy > 15 && v.xpEnergy < 21, `energy ${v.xpEnergy}`);
  }
  assert.deepEqual(states, [1, 2, 0]);
});

test('comms: hail opens a channel and the hailing flag, close shuts them', () => {
  const ship = new Ship(1, { rand: lcg(10) });
  const before = { ...run(ship, 1) };
  ship.command({ type: 'comms.hail', args: { target: 'command' } });
  const hailing = run(ship, 1);
  assert.deepEqual([hailing.hailing, hailing.channelsOpen - before.channelsOpen], [1, 1]);
  ship.command({ type: 'comms.close', args: {} });
  assert.equal(run(ship, 1).hailing, 0);
});

test('overrides: ramp moves a channel from where it is, noise adds spread, release drifts back to the model over its time', () => {
  const ship = new Ship(1, { rand: lcg(11) });
  run(ship, 2);
  ship.command({ type: 'scn.ramp', args: { ch: 'carrier', to: 15, over: 10 } });
  const mid = run(ship, 5);
  assert.ok(mid.carrier > 25 && mid.carrier < 35, `half way down: ${mid.carrier}`);
  assert.ok(Math.abs(run(ship, 6).carrier - 15) < 0.1);
  ship.command({ type: 'scn.noise', args: { ch: 'carrier', sigma: 3 } });
  const samples = Array.from({ length: 300 }, () => ship.step(0.02, T0).carrier);
  const mean = samples.reduce((a, b) => a + b) / samples.length;
  const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
  assert.ok(sd > 0.8 && sd < 5, `extra noise sd ${sd}`);
  ship.command({ type: 'scn.release', args: { over: 10, ch: 'carrier' } });
  assert.ok(Math.abs(run(ship, 12).carrier - 45) < 3, 'the carrier is back at its normal 45 dB');
  assert.equal(ship.ov.size, 0);
  assert.equal(ship.nz.size, 0);
});

test('a full release returns state as well: orders, condition, contacts, hull, crew', () => {
  const ship = new Ship(1, { rand: lcg(12) });
  ship.command({ type: 'scn.snap', args: { warp: 0, impulse: 10 } });
  ship.command({ type: 'ship.condition', args: { level: 'red' } });
  ship.command({ type: 'scn.contact', args: { n: 2, bearing: 80, range: 90000 } });
  ship.command({ type: 'scn.crew', args: { infect: [5, 6, 7] } });
  ship.command({ type: 'scn.hit', args: { quad: 'all', amount: 30, hull: 20 } });
  run(ship, 10);
  assert.ok(ship.out.contacts === 2 && ship.out.hullIntegrity < 85);
  ship.command({ type: 'scn.release', args: { over: 10 } });
  const v = run(ship, 40);
  assert.deepEqual([v.warpFactor > 5.9, v.impulse < 0.5, v.shieldsUp, v.contacts, v.hullIntegrity, v.crewCritical], [true, true, 0, 0, 100, 0]);
});

test('the crew: 430 people with their own baselines, the same on every run of a ship; infection moves vitals and counts; inoculation heals', () => {
  const a = new Ship(1, { rand: lcg(13) }).crew;
  const b = new Ship(1, { rand: lcg(99) }).crew;
  const c = new Ship(2, { rand: lcg(13) }).crew;
  assert.deepEqual(a.values(), b.values(), 'same ship, same people');
  assert.notDeepEqual(a.values(), c.values());
  const base = { ...a.values() };
  assert.ok(new Set(Object.keys(base).filter((k) => k.startsWith('hr_')).map((k) => Math.round(base[k]))).size > 15, 'baselines vary');
  for (let i = 0; i < 60; i++) a.step(1);
  assert.deepEqual([a.counts.watch, a.counts.critical], [0, 0], 'a healthy crew has nobody on watch');
  assert.ok(a.counts.meanHr > 66 && a.counts.meanHr < 78);
  a.infect(207);
  for (let i = 0; i < 10; i++) a.step(1);
  const v = a.values();
  assert.ok(v.hr_207 > base.hr_207 + 25 && v.nr_207 > 145 && v.bt_207 > base.bt_207 + 0.8, `crew 207: ${v.hr_207} ${v.nr_207} ${v.bt_207}`);
  assert.equal(a.counts.watch, 1);
  a.startSpread({ every: 8, max: 60 });
  for (let i = 0; i < 80; i++) a.step(1);
  assert.ok(a.counts.watch >= 50 && a.counts.watch <= 65 && a.counts.critical > 5, `watch ${a.counts.watch}, critical ${a.counts.critical}`);
  a.recover('all', 20, 'infected');
  for (let i = 0; i < 40; i++) a.step(1);
  assert.deepEqual([a.counts.watch, a.counts.critical], [0, 0]);
});

test('quarantine stops the spread from a deck', () => {
  const crew = new Ship(1, { rand: lcg(14) }).crew;
  for (let n = 13; n < 51; n++) crew.infect(n);
  crew.quarantine(2);
  crew.startSpread({ every: 2 });
  for (let i = 0; i < 40; i++) crew.step(1);
  assert.equal(crew.kind.filter((k) => k === 'infected').length, 38, 'nobody outside the quarantined deck caught it');
});

test('a storm duplicates, delays and corrupts some samples but loses none: every real sample reaches the server in time or late', () => {
  const rand = lcg(15);
  const samples = Array.from({ length: 1000 }, (_, i) => [i + 1, T0 + i * 20, 1, 2, 3]);
  const held = [];
  const sent = [];
  let now = T0;
  for (let i = 0; i < samples.length; i += 10) {
    now += 200;
    sent.push(...storm(samples.slice(i, i + 10), held, now, rand), ...dueFrom(held, now));
  }
  sent.push(...dueFrom(held, Infinity));
  const good = sent.filter((s) => s[2] <= 1000);
  const dup = good.length - new Set(good.map((s) => s[0])).size;
  const bad = sent.length - good.length;
  assert.equal(new Set(good.map((s) => s[0])).size, 1000, 'nothing lost');
  assert.ok(dup > 60 && dup < 150, `about 10% duplicated: ${dup}`);
  assert.ok(bad > 8 && bad < 40, `about 2% out of range: ${bad}`);
  assert.notDeepEqual(good.map((s) => s[0]).slice(0, 200), samples.slice(0, 200).map((s) => s[0]), 'some arrive out of order');
});

test('a mute sends its backlog scrambled and partly duplicated, never smaller', () => {
  const samples = Array.from({ length: 100 }, (_, i) => [i + 1, T0 + i]);
  const out = scramble(samples, lcg(16));
  assert.ok(out.length >= samples.length);
  assert.equal(new Set(out.map((s) => s[0])).size, 100);
});

test('unknown commands are refused; the old fault command still moves one channel and clear removes it', () => {
  const ship = new Ship(1, { rand: lcg(17) });
  assert.equal(ship.command({ type: 'warp-speed' }), false);
  assert.equal(ship.command({ type: 'fault', args: { channel: 'nope', target: 1 } }), true);
  assert.equal(ship.faults.size, 0);
  ship.command({ type: 'fault', args: { channel: 'chamberTemp', target: 90, rampSec: 1 } });
  assert.equal(ship.step(0.1, Date.now() + 5000).chamberTemp, 90);
  ship.command({ type: 'clear' });
  assert.ok(ship.step(0.1, Date.now() + 5100).chamberTemp < 50);
  assert.equal(channelsOf(1).length, 121);
});
