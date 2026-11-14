import test from 'node:test';
import assert from 'node:assert/strict';
import { Detector } from '../src/anomaly/detector.js';

// every channel the rules read, at a calm value
const calm = { plasmaTemp: 40, corePower: 80, antimatterFlow: 200, shieldFore: 90, shieldAft: 90, shieldPort: 90, shieldStbd: 90, o2Level: 21, co2Level: 600, cabinTemp: 22, cabinPressure: 101, heartRate: 70, stressIndex: 20 };

function rig() {
  let now = 1_000_000;
  const alerts = [];
  const d = new Detector({ onAlert: (a) => alerts.push(a), now: () => now, graceMs: 0 });
  const step = (id, s, ms = 20) => {
    now += ms;
    d.push(id, { ...calm, ts: now, ...s });
  };
  return { d, alerts, step, advance: (ms) => (now += ms), tick: () => d.tick() };
}
const jitter = (i) => (i % 3) * 0.1;

test('threshold: plasma temperature over 70 warns once, 85 escalates, debounce keeps it to one open alert', () => {
  const { alerts, step } = rig();
  for (let i = 0; i < 10; i++) step(1, {});
  for (let i = 0; i < 50; i++) step(1, { plasmaTemp: 75 });
  assert.equal(alerts.filter((a) => a.type === 'core-temp').length, 1);
  assert.equal(alerts[0].severity, 'warn');
  assert.equal(alerts[0].group, 'warp');
  for (let i = 0; i < 5; i++) step(1, { plasmaTemp: 90 });
  assert.deepEqual(alerts.filter((a) => a.type === 'core-temp').map((a) => a.severity), ['warn', 'critical']);
  // clear for under 3 s then back: still the same open alert, no new one
  for (let i = 0; i < 20; i++) step(1, {});
  for (let i = 0; i < 5; i++) step(1, { plasmaTemp: 90 });
  assert.equal(alerts.filter((a) => a.type === 'core-temp').length, 2);
});

test('threshold: alert reopens after the condition was clear for 3 s', () => {
  const { alerts, step } = rig();
  for (let i = 0; i < 5; i++) step(2, { corePower: 110 });
  for (let i = 0; i < 200; i++) step(2, {}); // 4 s clear
  for (let i = 0; i < 5; i++) step(2, { corePower: 110 });
  assert.equal(alerts.filter((a) => a.type === 'core-power').length, 2);
});

test('threshold: a low-side rule alerts below its limits and names the shield that dropped', () => {
  const { alerts, step } = rig();
  for (let i = 0; i < 5; i++) step(3, { shieldAft: 25 });
  for (let i = 0; i < 5; i++) step(3, { shieldAft: 5 });
  const s = alerts.filter((a) => a.type === 'shield-low');
  assert.deepEqual(s.map((a) => [a.severity, a.channel, a.group]), [['warn', 'shieldAft', 'shields'], ['critical', 'shieldAft', 'shields']]);
  assert.match(s[0].message, /^Shield aft 25 %$/);
  step(3, { o2Level: 16 });
  assert.equal(alerts.find((a) => a.type === 'oxygen-low').severity, 'critical');
});

test('z-score: a sudden jump held for 0.5 s is flagged, a one-sample blip is not', () => {
  const { alerts, step } = rig();
  for (let i = 0; i < 1600; i++) step(4, { cabinTemp: 22 + jitter(i) });
  step(4, { cabinTemp: 35 });
  for (let i = 0; i < 5; i++) step(4, { cabinTemp: 22 });
  assert.equal(alerts.filter((a) => a.type === 'zscore').length, 0);
  for (let i = 0; i < 40; i++) step(4, { cabinTemp: 35 });
  const z = alerts.filter((a) => a.type === 'zscore');
  assert.equal(z.length, 1);
  assert.deepEqual([z[0].channel, z[0].group], ['cabinTemp', 'lifesupport']);
  assert.match(z[0].message, /^Cabin temperature is \d+\.\d standard deviations above its recent mean$/);
});

test('z-score: warm-up and window follow sample time, so a 10 Hz source is watched after 30 s like a 50 Hz one', () => {
  const { alerts, step } = rig();
  for (let i = 0; i < 160; i++) step(4, { cabinTemp: 22 + jitter(i) }, 200);
  for (let i = 0; i < 10; i++) step(4, { cabinTemp: 35 }, 200);
  assert.equal(alerts.filter((a) => a.type === 'zscore').length, 1);
});

test('after a silence the source is relearned: other values raise no z-score warning, real faults still alert', () => {
  const { alerts, step, advance, tick } = rig();
  for (let i = 0; i < 400; i++) step(4, { cabinTemp: 22 + jitter(i), heartRate: 70 + jitter(i) });
  advance(3000);
  tick();
  for (let i = 0; i < 100; i++) step(4, { cabinTemp: 30, heartRate: 95 });
  assert.equal(alerts.filter((a) => a.type === 'zscore').length, 0);
  assert.equal(alerts.filter((a) => a.type === 'link-loss').length, 1); // the silence itself is still reported
  for (let i = 0; i < 100; i++) step(4, { cabinTemp: 30 + jitter(i), plasmaTemp: 90 });
  assert.equal(alerts.filter((a) => a.type === 'core-temp' && a.severity === 'critical').length, 1);
  for (let i = 0; i < 1400; i++) step(4, { cabinTemp: 30 + jitter(i) });
  for (let i = 0; i < 40; i++) step(4, { cabinTemp: 42 });
  assert.equal(alerts.filter((a) => a.type === 'zscore' && a.channel === 'cabinTemp').length, 1);
});

test('no link-loss alert in the first seconds after the server starts or a source first reports, then it works as before', () => {
  let now = 1_000_000;
  const alerts = [];
  const d = new Detector({ onAlert: (a) => alerts.push(a), now: () => now });
  d.tick(); // the server's timers start
  now += 3000;
  d.push(5, { ...calm, ts: now }); // the source's first sample, a backlog batch after an outage
  now += 2500;
  d.tick(); // 2.5 s silent, 2.5 s since first heard, 5.5 s since the server started
  assert.equal(alerts.length, 0);
  now += 3000;
  d.tick(); // 5.5 s silent, source known for 5.5 s
  const loss = alerts.filter((a) => a.type === 'link-loss');
  assert.equal(loss.length, 1);
  assert.equal(loss[0].group, null); // not tied to a channel group: every role sees it
});

test('link loss after 1.5 s of silence', () => {
  const { alerts, step, advance, tick } = rig();
  step(5, {});
  advance(1000);
  tick();
  assert.equal(alerts.length, 0);
  advance(600);
  tick();
  assert.equal(alerts[0].type, 'link-loss');
});

// a drifting reading the operator then fixes: one source at 50 Hz, the shield that failed is restored
function run(repair) {
  let now = 0;
  const alerts = [];
  const d = new Detector({ onAlert: (a) => alerts.push(a), now: () => now });
  const feed = (fromMs, ms, v) => { for (let t = 0; t < ms; t += 20) { now = fromMs + t; d.push(1, { ...calm, cabinPressure: v(t) + 0.01 * Math.sin(t) }); } };
  feed(0, 12000, () => 101);
  feed(12000, 90000, (t) => Math.max(0, 101 - 4 * (t / 1000))); // a leak left until the cabin is empty
  const atRepair = alerts.length;
  repair(d);
  feed(102000, 30000, () => 101); // repaired
  return { after: alerts.slice(atRepair), open: d.openSeverity(1) };
}

test('a repair after a long drift raises no new alert once reset() is called', () => {
  const { after, open } = run((d) => d.reset(1));
  assert.deepEqual(after.map((a) => a.type), []);
  assert.equal(open, 0);
});

test('without reset() the drifted value became the normal and the repair reads as a lasting anomaly', () => {
  const { after, open } = run(() => {});
  assert.ok(after.some((a) => a.type === 'zscore'));
  assert.ok(open >= 2);
});
