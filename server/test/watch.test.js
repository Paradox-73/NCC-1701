import test from 'node:test';
import assert from 'node:assert/strict';
import { channelsOf } from '@ncc/shared/schema.js';
import { Detector } from '../src/anomaly/detector.js';
import { IngestWatch } from '../src/ingest/watch.js';

function rig() {
  let now = 1_000_000;
  const alerts = [];
  const detector = new Detector({ onAlert: (a) => alerts.push(a), now: () => now, graceMs: 0 });
  const watch = new IngestWatch({ detector, now: () => now });
  return { alerts, detector, watch, advance: (ms) => (now += ms), at: () => now };
}
const types = (alerts) => alerts.map((a) => `${a.sourceId} ${a.type} ${a.severity}`);

test('three refused handshakes within 2 s raise ingest-auth; two do not; it clears 3 s after the attempts stop', () => {
  const { alerts, watch, advance } = rig();
  watch.note(1, { refused: 2 });
  watch.tick();
  assert.deepEqual(alerts, []);
  advance(500);
  watch.note(1, { refused: 1 });
  watch.tick();
  assert.deepEqual(types(alerts), ['1 ingest-auth warn']);
  for (let i = 0; i < 40; i++) { advance(250); watch.tick(); } // 10 s later nothing new
  watch.note(1, { refused: 3 });
  watch.tick();
  assert.equal(alerts.length, 2, 'it reopened after it had been clear');
});

test('invalid samples above 20 a second warn, throttled samples above 200 a second are critical, each per source', () => {
  const { alerts, watch, advance } = rig();
  for (let i = 0; i < 8; i++) { watch.note(99, { invalid: 30 }); watch.note(99, { throttled: 120 }); watch.note(1, { invalid: 2 }); advance(250); watch.tick(); }
  assert.deepEqual(types(alerts).sort(), ['99 ingest-flood critical', '99 ingest-invalid warn']);
  assert.equal(alerts[0].group, null, 'ingest alerts belong to no channel group: every role sees them');
  assert.ok(alerts.every((a) => a.sourceId === 99), 'a source with a few invalid samples stays quiet');
});

test('settle(): while an operating point changes on purpose its statistics follow the values and nothing is flagged', () => {
  let now = 1_000_000;
  const alerts = [];
  const d = new Detector({ onAlert: (a) => alerts.push(a), now: () => now, graceMs: 0 });
  const calm = Object.fromEntries(channelsOf(1).map((c) => [c.key, c.nominal]));
  const feed = (secs, reactionRate) => { for (let i = 0; i < secs * 50; i++) { now += 20; d.push(1, { ...calm, reactionRate: reactionRate + 0.3 * Math.sin(i), ts: now }); } };
  feed(40, 64); // warm-up done
  d.settle(1, 20_000);
  feed(12, 73); // warp 6 to 8: the reaction rate moves 9 points
  assert.deepEqual(alerts.filter((a) => a.type === 'zscore'), []);
  feed(60, 73);
  assert.deepEqual(alerts.filter((a) => a.type === 'zscore'), [], 'the new level became normal');
  // without settle the same step is an anomaly
  const alerts2 = [];
  now = 1_000_000;
  const d2 = new Detector({ onAlert: (a) => alerts2.push(a), now: () => now, graceMs: 0 });
  const feed2 = (secs, v) => { for (let i = 0; i < secs * 50; i++) { now += 20; d2.push(1, { ...calm, reactionRate: v + 0.3 * Math.sin(i), ts: now }); } };
  feed2(40, 64);
  feed2(12, 73);
  assert.equal(alerts2.filter((a) => a.type === 'zscore' && a.channel === 'reactionRate').length, 1);
});

test('a sickbay hub that sends once a second is not lost until 3.5 s of silence; a ship is lost after 1.5 s', () => {
  let now = 1_000_000;
  const alerts = [];
  const d = new Detector({ onAlert: (a) => alerts.push(a), now: () => now, graceMs: 0 });
  const calm = (id) => Object.fromEntries(channelsOf(id).map((c) => [c.key, c.nominal]));
  d.push(11, { ...calm(11), ts: now });
  d.push(1, { ...calm(1), ts: now });
  now += 2000;
  d.tick();
  assert.deepEqual(alerts.map((a) => a.sourceId), [1], 'only the ship, 2 s silent');
  now += 2000;
  d.tick();
  assert.deepEqual(alerts.map((a) => a.sourceId), [1, 11]);
});

test('a sickbay source runs only crew rules: a fever on crew 207 alerts in the deck 7 group, a ship rule never fires on it', () => {
  let now = 1_000_000;
  const alerts = [];
  const d = new Detector({ onAlert: (a) => alerts.push(a), now: () => now, graceMs: 0 });
  const calm = Object.fromEntries(channelsOf(11).map((c) => [c.key, c.nominal]));
  for (let i = 0; i < 5; i++) { now += 1000; d.push(11, { ...calm, bt_207: 39.2, ts: now }); }
  assert.deepEqual(alerts.map((a) => [a.type, a.channel, a.group, a.severity]), [['fever', 'bt_207', 'bio-d07', 'warn']]);
  assert.match(alerts[0].message, /Body temperature, crew 207/);
});
