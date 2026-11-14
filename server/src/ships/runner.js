import { EVENTS } from '@ncc/shared/schema.js';
import { HttpError } from '../middleware/index.js';
import { COMMAND_SCHEMA } from './commands.js';

const SCENARIO_ACTOR = { username: 'scenario', role: 'scenario' };
const RELEASE_SEC = 10;
// verb -> the simulator command it becomes (the simulator's handlers are in simulator/src/commands.js)
const SIM_VERBS = { set: 'scn.set', ramp: 'scn.ramp', noise: 'scn.noise', rogue: 'scn.rogue', hit: 'scn.hit', contact: 'scn.contact', crew: 'scn.crew', fault: 'scn.fault', snap: 'scn.snap', release: 'scn.release' };

const asList = (v) => (Array.isArray(v) ? v : [v]);

/**
 * Runs one scenario at a time. A scenario is a script from shared/scenarios: steps with a time `t` in seconds and
 * verbs (docs/DOMAIN.md section 8). The clock runs in real time. `await` stops the clock until the named command
 * arrives from a dashboard or its timeout passes, when the runner sends the command itself, so every scenario also
 * finishes unattended. When a scenario ends, the simulator lets every channel it touched drift back to
 * normal over RELEASE_SEC seconds.
 */
export class ScenarioRunner {
  constructor(world, scenarios) {
    this.world = world;
    this.scenarios = scenarios;
    this.cur = null;
    this.lastProgressSec = -1;
  }

  /** What a dashboard that joins late needs: the running scenario's progress, or null. */
  status() {
    return this.cur ? this.#progress(this.cur.awaiting ? 'awaiting' : 'running') : null;
  }

  start(id, by) {
    const sc = this.scenarios[id];
    if (!sc) throw new HttpError(404, `no scenario ${id}`);
    if (this.cur) throw new HttpError(409, `scenario ${this.cur.sc.id} is already running`);
    for (const ship of sc.ships) if (!this.world.online(ship)) throw new HttpError(409, `ship ${ship} is not connected`);
    const steps = sc.steps.map((s, i) => ({ s, i })).sort((a, b) => a.s.t - b.s.t || a.i - b.i).map((x) => x.s);
    this.cur = { sc, steps, i: 0, t: 0, last: this.world.now(), awaiting: null, by };
    this.lastProgressSec = -1;
    this.#emit('running');
    return sc;
  }

  /** Stops the running scenario and restores normal running. False when none runs. */
  stop(by) {
    if (!this.cur) return false;
    this.#finish('stopped', by);
    return true;
  }

  /** The awaited command of ship `shipId`, if a scenario waits for exactly this one. */
  waitingFor(shipId, cmd) {
    const a = this.cur?.awaiting;
    return !!a && a.shipId === shipId && a.match.type === cmd.type && Object.entries(a.match).every(([k, v]) => cmd[k] === v);
  }

  /** Called with every command a dashboard sent: opens the gate when it is the awaited one. */
  notify(shipId, cmd) {
    if (!this.waitingFor(shipId, cmd)) return;
    this.cur.awaiting = null;
    this.#emit('running');
  }

  tick(now) {
    const c = this.cur;
    if (!c) return;
    if (!c.awaiting) c.t += (now - c.last) / 1000; // the clock stands still while a step waits for the bridge
    c.last = now;
    if (c.awaiting && now >= c.awaiting.deadline) {
      const { shipId, issue } = c.awaiting;
      c.awaiting = null;
      this.world.execute(shipId, issue, SCENARIO_ACTOR); // nobody acted: the scenario does it, so it still ends
      this.#emit('running');
    }
    while (this.cur === c && !c.awaiting && c.i < c.steps.length && c.steps[c.i].t <= c.t) {
      const step = c.steps[c.i++];
      this.#run(step);
      if (this.cur === c) this.#emit(c.awaiting ? 'awaiting' : 'running');
    }
    if (this.cur !== c) return;
    if (!c.awaiting && c.i >= c.steps.length) this.#finish('ended', 'scenario');
    else if (Math.floor(c.t) !== this.lastProgressSec) this.#emit(c.awaiting ? 'awaiting' : 'running');
  }

  #run(step) {
    const c = this.cur;
    const ship = step.source ?? c.sc.ships[0];
    const w = this.world;
    const sim = (type, args) => w.sendSim(ship, { type, args });
    if (step.log) w.logLine(ship, step.log, { sound: step.sound, by: 'log' });
    else if (step.sound) w.fx(ship, 'sound', { sound: step.sound });
    if (step.snap) {
      w.settle(ship, 30_000);
      sim('scn.snap', step.snap);
    }
    if (step.cmd) w.execute(ship, step.cmd, SCENARIO_ACTOR);
    for (const verb of ['set', 'ramp', 'noise', 'hit', 'contact', 'crew', 'fault', 'rogue', 'release']) {
      for (const { source, ...args } of asList(step[verb] ?? [])) w.sendSim(source ?? ship, { type: SIM_VERBS[verb], args });
    }
    if (step.fx) w.fx(ship, step.fx.name, step.fx);
    if (step.condition) w.setCondition(ship, step.condition, 'scenario');
    if (step.await) {
      const { type, ...match } = step.await;
      const timeout = step.timeout ?? 10;
      c.awaiting = { shipId: ship, match: { type, ...match }, issue: COMMAND_SCHEMA.parse({ ...step.issue, type, ...match }), deadline: this.world.now() + timeout * 1000, timeout };
    }
    if (step.end) c.i = c.steps.length;
  }

  #finish(state, by) {
    const c = this.cur;
    this.cur = null;
    for (const ship of c.sc.ships) {
      this.world.sendSim(ship, { type: 'scn.release', args: { over: RELEASE_SEC } });
      this.world.setCondition(ship, 'normal', by);
      if (this.#offCruise(ship)) this.world.settle(ship, 30_000); // the ship goes back to warp 6: its statistics follow, but a scenario that never left cruise leaves them alone
      this.world.logLine(ship, state === 'ended' ? `Scenario ended: ${c.sc.title}` : `Scenario stopped: ${c.sc.title}`, { by });
    }
    this.#emit(state, c);
  }

  #offCruise(ship) {
    const v = this.world.latest(ship);
    return !v || Math.abs(v.warpFactor - 6) > 0.3 || v.impulse > 5;
  }

  #progress(state, c = this.cur) {
    const a = c.awaiting;
    return {
      state, id: c.sc.id, title: c.sc.title, shipIds: c.sc.ships, t: Math.round(c.t * 10) / 10, step: c.i, steps: c.steps.length,
      duration: c.sc.duration ?? c.steps.at(-1)?.t ?? 0,
      awaiting: a ? { ...a.match, shipId: a.shipId, timeout: a.timeout, secondsLeft: Math.max(0, Math.round((a.deadline - this.world.now()) / 100) / 10) } : null,
      ts: this.world.now(),
    };
  }

  #emit(state, c = this.cur) {
    this.lastProgressSec = Math.floor(c.t);
    const p = this.#progress(state, c);
    for (const ship of c.sc.ships) this.world.emit(ship, EVENTS.SCENARIO, p);
  }
}
