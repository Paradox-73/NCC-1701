// The placeholder simulator against the detector and the wire format: calm running is silent, commands move channels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANNELS, checkPacked, packSample, unpackSample } from '@ncc/shared/schema.js';
import { Detector } from '../src/anomaly/detector.js';
import { Ship } from '../../simulator/src/physics.js';

// deterministic generator so a failure reproduces
const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

function run({ seconds, hz = 10, at = {} }) {
  let now = 1_800_000_000_000;
  const alerts = [];
  const d = new Detector({ onAlert: (a) => alerts.push(a), now: () => now });
  const ships = [1, 2, 3].map((id) => new Ship(id, { rand: lcg(id) }));
  const dt = 1 / hz;
  for (let i = 0; i < seconds * hz; i++) {
    now += 1000 * dt;
    at[i / hz]?.(ships);
    for (const [n, ship] of ships.entries()) {
      const packed = packSample(i + 1, now, ship.step(dt, now));
      assert.equal(checkPacked(packed, now), null, 'every simulated sample is valid on the wire');
      d.push(n + 1, unpackSample(packed));
    }
    if (i % 3 === 0) d.tick();
  }
  return { alerts, d };
}

test('ten minutes of normal running raise no alert on any source', () => {
  const { alerts } = run({ seconds: 600 });
  assert.deepEqual(alerts.map((a) => `${a.sourceId} ${a.type} ${a.channel}`), []);
});

test('a fault command moves a channel past its threshold and raises its alert; clear brings it back', () => {
  let ship2;
  const { alerts, d } = run({
    seconds: 120,
    at: {
      60: ([, s2]) => {
        ship2 = s2;
        s2.command({ type: 'fault', args: { channel: 'plasmaTemp', target: 95, rampSec: 5 } });
      },
    },
  });
  const hit = alerts.filter((a) => a.type === 'core-temp');
  assert.deepEqual(hit.map((a) => [a.sourceId, a.severity]), [[2, 'warn'], [2, 'critical']]);
  assert.ok(alerts.every((a) => a.sourceId === 2), 'only the faulted source alerts');
  assert.equal(d.openSeverity(2), 3);
  ship2.command({ type: 'clear' });
  assert.ok(ship2.step(0.1, ship2.lastTs + 100).plasmaTemp < 60);
});

test('unknown commands are refused and every channel stays inside its range under any fault', () => {
  const ship = new Ship(1, { rand: lcg(7) });
  assert.equal(ship.command({ type: 'warp-speed' }), false);
  assert.equal(ship.command({ type: 'fault', args: { channel: 'nope', target: 1 } }), true); // handled, but ignored: no such channel
  assert.equal(ship.faults.size, 0);
  ship.command({ type: 'fault', args: { channel: 'o2Level', target: -50, rampSec: 1 } });
  const v = ship.step(0.1, Date.now() + 5000);
  const c = CHANNELS.find((x) => x.key === 'o2Level');
  assert.equal(v.o2Level, c.min);
});
