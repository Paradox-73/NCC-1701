// Fixes from the code audit: a scenario with an offline ship, the overview per role, simulator guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS } from '@ncc/shared/scenarios/index.js';
import { World } from '../src/ships/world.js';
import { rowsForRole } from '../src/live/broadcaster.js';
import { Ship } from '../../simulator/src/physics.js';

test('a ship that goes offline mid-scenario does not make World.tick() throw', () => {
  let now = Date.UTC(2026, 10, 14, 12);
  let linked = true;
  const errors = [];
  const world = new World({ sendSim: () => linked, emit: () => {}, now: () => now, scenarios: SCENARIOS, online: () => linked, log: { error: (o) => errors.push(o) } });
  world.execute(1, { type: 'scenario.start', id: 'the-doomsday-machine' }, { username: 'command', role: 'starfleet_command' });
  now += 2000;
  world.tick();
  linked = false;
  for (let t = 0; t < 120; t++) {
    now += 100;
    assert.doesNotThrow(() => world.tick());
  }
  assert.ok(errors.length > 0, 'the failed step is logged');
});

test('the overview shows a role only its ships, and blanks the columns of groups it lacks', () => {
  const rows = [[1, 1, 0, 600, 995, 100, 200, 900], [2, 1, 0, 700, 970, 300, 400, 350]];
  assert.deepEqual(rowsForRole(rows, 'captain').map((r) => r[0]), [1], 'the captain sees only the Enterprise');
  assert.deepEqual(rowsForRole(rows, 'starfleet_command').map((r) => r[0]), [1, 2]);
  const medical = rowsForRole(rows, 'chief_medical_officer')[0];
  assert.deepEqual(medical.slice(3), [0, 0, 0, 0, 0], 'no helm or shield group: those columns are zero');
  assert.deepEqual(rowsForRole(rows, 'captain')[0], rows[0], 'the captain has both groups: the row is whole');
});

test('a fault with a non-finite ramp time is ignored, so no channel turns NaN', () => {
  const ship = new Ship(1, { rand: () => 0.5 });
  ship.command({ type: 'fault', args: { channel: 'speed', target: 100, rampSec: 'x' } });
  assert.equal(ship.faults.size, 0);
});

test('a ship that reaches the sector edge turns back toward the centre', () => {
  const ship = new Ship(1, { rand: () => 0.5 });
  ship.s.posX = 4950;
  ship.order.heading = 90;
  for (let i = 0; i < 100; i++) ship.step(0.02, 1_800_000_000_000 + i * 20);
  assert.ok(Math.abs(ship.order.heading - 270) < 1, 'ordered back toward the origin');
});
