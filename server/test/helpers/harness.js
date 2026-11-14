// An offline bridge: the simulator's ships and crews, the real detector, the real World and scenario runner, all on one
// virtual clock, with no sockets and no database. A scenario that takes 100 s runs in about a second, deterministically.
import { SCENARIOS } from '@ncc/shared/scenarios/index.js';
import { SOURCES, channelsOf, shipOf } from '@ncc/shared/schema.js';
import { Detector } from '../../src/anomaly/detector.js';
import { IngestWatch } from '../../src/ingest/watch.js';
import { World } from '../../src/ships/world.js';
import { Ship } from '../../../simulator/src/physics.js';

const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const START = Date.UTC(2026, 10, 14, 12, 0, 0);

export function makeBridge({ seed = 1, scenarios = SCENARIOS, withCrew = true } = {}) {
  let now = START;
  const alerts = []; // { t, sourceId, type, channel, severity, group, message } with t in seconds on the virtual clock
  const events = []; // { t, shipId, event, payload } what ship:<id> rooms would carry
  const stream = { storm: new Map() }; // sourceId -> storm seconds requested
  const ships = Object.fromEntries(SOURCES.filter((s) => s.kind === 'ship').map((s) => [s.id, new Ship(s.id, { rand: lcg(seed * 100 + s.id) })]));
  const t = () => Math.round(((now - START) / 1000) * 10) / 10;
  const detector = new Detector({ onAlert: (a) => { alerts.push({ ...a, t: t() }); world.onAlert(a); }, now: () => now, graceMs: 0 });
  const muted = new Map(); // sourceId -> mute until
  const watch = new IngestWatch({ detector, now: () => now });
  let rogue = null; // { phase, until }: what the rogue source of Space Seed does to the server's counters
  const world = new World({
    sendSim: (id, cmd) => {
      const ship = ships[id];
      if (!ship) return false;
      if (cmd.type === 'mute' || (cmd.type === 'scn.fault' && (cmd.args.fault === 'mute' || cmd.args.fault === 'lost'))) muted.set(id, now + (cmd.args.fault === 'lost' ? 600 : (cmd.args.seconds ?? 3)) * 1000);
      else if (cmd.type === 'scn.fault' && cmd.args.fault === 'storm') stream.storm.set(id, cmd.args.seconds);
      else if (cmd.type === 'scn.rogue') {
        (stream.rogue ??= []).push(cmd.args.phase);
        rogue = { phase: cmd.args.phase, until: now + (cmd.args.phase === 'auth' ? 1500 : (cmd.args.seconds ?? 5) * 1000) };
      }
      else if (cmd.type === 'scn.release' && muted.get(id) > now + 60_000) muted.set(id, now + 30_000); // a lost ship comes back 30 s after the scenario
      return ship.command(cmd) !== false || cmd.type === 'mute' || cmd.type === 'scn.fault' || cmd.type === 'scn.rogue';
    },
    emit: (shipId, event, payload) => events.push({ t: t(), shipId, event, payload }),
    now: () => now,
    detector,
    scenarios,
    online: (id) => !!ships[id],
    latest: (id) => lastValues[id] ?? null,
  });

  const lastValues = {};
  const rates = Object.fromEntries(SOURCES.map((s) => [s.id, s.hz]));
  const clocks = Object.fromEntries(SOURCES.map((s) => [s.id, 0]));

  /** Runs `seconds` of virtual time in 20 ms ticks. `on(t)` is called every tick with the time since the run began. */
  function run(seconds, on) {
    const ticks = Math.round(seconds * 50);
    for (let i = 0; i < ticks; i++) {
      now += 20;
      if (on) on(t());
      for (const s of SOURCES) {
        if (s.kind === 'crew' && !withCrew) continue;
        clocks[s.id] += 0.02;
        if (clocks[s.id] < 1 / rates[s.id] - 1e-9) continue;
        clocks[s.id] = 0;
        if (s.kind === 'ship') {
          const v = ships[s.id].step(1 / rates[s.id], now);
          if (muted.get(s.id) > now) continue;
          detector.push(s.id, { ...v, ts: now, seq: 1 });
          lastValues[s.id] = v;
        } else {
          detector.push(s.id, { ...ships[s.ship].crew.values(), ts: now, seq: 1 });
        }
      }
      if (i % 5 === 0) world.tick();
      if (i % 13 === 0) {
        detector.tick();
        watch.tick();
      }
      // the counts simulator/src/rogue.js produces on a real server (measured in the live run): 5 refused handshakes, 2,000 invalid samples a second, about 4,800 throttled a second
      if (rogue && now < rogue.until) {
        if (rogue.phase === 'auth' && i % 15 === 0) watch.note(1, { refused: 1 });
        if (rogue.phase === 'invalid') watch.note(99, { invalid: 40 });
        if (rogue.phase === 'flood') watch.note(99, { throttled: 97 });
      }
    }
  }

  const as = (username, role) => ({ username, role });
  return {
    ships, world, detector, watch, alerts, events, stream, run, t, lastValues, as,
    /** Sends a bridge command as a dashboard would. */
    command: (shipId, cmd, who = as('captain', 'captain')) => world.execute(shipId, cmd, who),
    /** Alerts matching `type` (and optionally a source id), as [t, severity] rows. */
    timeline: (type, sourceId) => alerts.filter((a) => a.type === type && (sourceId === undefined || a.sourceId === sourceId)).map((a) => [a.t, a.severity]),
    ev: (event) => events.filter((e) => e.event === event),
    channels: channelsOf,
    shipOf,
  };
}
