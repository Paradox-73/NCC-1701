import { ESCALATING_GROUPS, EVENTS, SHIP_IDS, SOURCE_BY_ID, shipOf, stardate } from '@ncc/shared/schema.js';
import { HttpError } from '../middleware/index.js';
import { ackText, argsOf, SCENARIO_ONLY } from './commands.js';
import { ScenarioRunner } from './runner.js';

const LOG_KEEP = 60;
const SETTLE_COMMANDS = new Set(['helm.warp', 'helm.impulse', 'helm.stop']);

/**
 * The server's picture of each ship that telemetry does not carry: its condition (normal, yellow, red), its log, the
 * stardate offset a time warp leaves behind, and the scenario that is running. Commands from the bridge and the
 * scenario runner both go through execute(), so the log, the acknowledgement and the simulator relay are the same.
 * Everything outside is injected: `sendSim(sourceId, { type, args })` returns false when the source is offline,
 * `emit(shipId, event, payload)` sends to room ship:<id>, `detector` is told when an operating point changes.
 */
export class World {
  constructor({ sendSim, emit, now = Date.now, detector, scenarios, online = () => true, latest = () => null, log, resolveAlerts = async () => 0 }) {
    this.latest = latest;
    this.sendSim = sendSim;
    this._emit = emit;
    this.now = now;
    this.detector = detector;
    this.online = online;
    this.log = log;
    this.resolveAlerts = resolveAlerts;
    this.ships = new Map(SHIP_IDS.map((id) => [id, { condition: 'normal', lines: [], stardateOffset: 0 }]));
    this.runner = new ScenarioRunner(this, scenarios);
  }

  ship(id) {
    const s = this.ships.get(id);
    if (!s) throw new HttpError(404, 'no such ship');
    return s;
  }

  condition(id) {
    return this.ships.get(id)?.condition ?? 'normal';
  }

  emit(shipId, event, payload) {
    this._emit(shipId, event, payload);
  }

  /** Changes a ship's condition, tells the simulator and the bridge. Returns false when nothing changed. */
  setCondition(id, level, by) {
    const s = this.ship(id);
    if (s.condition === level) return false;
    s.condition = level;
    this.sendSim(id, { type: 'ship.condition', args: { level } });
    this.emit(id, EVENTS.SHIP_CONDITION, { shipId: id, level, by, ts: this.now() });
    return true;
  }

  /** Writes a line to a ship's log and sends it to its room. `sound` is a cue name for the dashboard. */
  logLine(id, text, { sound, by = 'ship' } = {}) {
    const s = this.ship(id);
    const ts = this.now();
    const line = { shipId: id, ts, stardate: Math.round((stardate(ts) + s.stardateOffset) * 100) / 100, text, ...(sound && { sound }), by };
    s.lines.push(line);
    if (s.lines.length > LOG_KEEP) s.lines.shift();
    this.emit(id, EVENTS.SHIP_LOG, line);
    return line;
  }

  /** A scenario starts or ends: closes the alerts its ships have open. The database write runs in the background. */
  scenarioEdge(shipIds, reason) {
    Promise.resolve(this.resolveAlerts(shipIds, reason)).catch((err) => this.log?.error({ err: err.message }, 'resolving alerts failed'));
  }

  /** Puts a ship's stardate back on the real clock; the bridges get a 'timewarp' that undoes the offset. */
  resetStardate(id) {
    const s = this.ship(id);
    if (s.stardateOffset) this.fx(id, 'timewarp', { stardateDelta: -s.stardateOffset });
  }

  /** A visual cue for the dashboards. A 'timewarp' with `stardateDelta` moves the ship's stardate. */
  fx(id, name, fields = {}) {
    const s = this.ship(id);
    if (name === 'timewarp') s.stardateOffset += fields.stardateDelta ?? 0;
    this.emit(id, EVENTS.SHIP_FX, { shipId: id, ts: this.now(), name, ...fields });
  }

  /** The operating point of a ship is changing on purpose: its statistics follow instead of flagging it. */
  settle(id, ms) {
    this.detector?.settle(id, ms);
  }

  /**
   * Runs a validated command. `actor` is { username, role }; the scenario runner uses { username: 'scenario', role: 'scenario' }
   * and may send scenario-only commands. Throws HttpError (404, 409); returns { ok, at, text }.
   */
  execute(shipId, cmd, actor) {
    this.ship(shipId);
    const fromScenario = actor.role === 'scenario';
    const at = this.now();
    let text = ackText(cmd);
    if (SCENARIO_ONLY.has(cmd.type) && !fromScenario && !this.runner.waitingFor(shipId, cmd)) throw new HttpError(409, `${cmd.type} is only available while a scenario waits for it`);

    if (cmd.type === 'scenario.start') {
      text = `Scenario: ${this.runner.start(cmd.id, actor.username).title}`;
    } else if (cmd.type === 'scenario.stop') {
      if (!this.runner.stop(actor.username)) throw new HttpError(409, 'no scenario is running');
    } else if (cmd.type === 'ship.condition') {
      this.setCondition(shipId, cmd.level, actor.username);
    } else {
      const target = cmd.type === 'sim.fault' ? (cmd.sourceId ?? shipId) : shipId;
      if (this.#movesOperatingPoint(shipId, cmd)) this.settle(shipId, 20_000);
      const relayed = cmd.type === 'sim.fault' ? this.sendSim(target, { type: cmd.fault === 'mute' ? 'mute' : cmd.fault === 'clear' ? 'clear' : `fault.${cmd.fault}`, args: { seconds: cmd.seconds ?? 5 } }) : this.sendSim(target, { type: cmd.type, args: argsOf(cmd) });
      if (!relayed) throw new HttpError(409, `source ${target} is not connected`);
      if (cmd.type === 'sim.fault' && cmd.fault === 'clear') this.detector?.reset(target);
    }
    this.emit(shipId, EVENTS.COMMAND_ACK, { shipId, type: cmd.type, args: argsOf(cmd), by: actor.username, role: actor.role, ok: true, at, text });
    this.logLine(shipId, text, { by: actor.username });
    if (!fromScenario) this.runner.notify(shipId, cmd);
    return { ok: true, at, text };
  }

  /** An alert came out of the detector: a critical one in the hull, shields, life support, warp core or crew raises a ship at normal to yellow. */
  /** True when a helm command changes the warp or impulse level enough to move the statistics of the warp core: a repeat of the current order does not. */
  #movesOperatingPoint(shipId, cmd) {
    if (!SETTLE_COMMANDS.has(cmd.type)) return false;
    const v = this.latest(shipId);
    if (!v) return true;
    if (cmd.type === 'helm.warp') return Math.abs(cmd.factor - v.warpFactor) > 0.3;
    if (cmd.type === 'helm.impulse') return Math.abs(cmd.percent - v.impulse) > 5;
    return v.warpFactor > 0.3 || v.impulse > 5;
  }

  onAlert(a) {
    if (a.severity !== 'critical' || !SOURCE_BY_ID[a.sourceId] || !ESCALATING_GROUPS.includes(a.group)) return;
    const id = shipOf(a.sourceId);
    if (this.condition(id) === 'normal' && this.setCondition(id, 'yellow', 'alert system')) this.logLine(id, `Yellow alert: ${a.message}`, { by: 'alert system', sound: 'klaxon' });
  }

  /** A source's simulator connected: send it the ship's condition, which it would otherwise have forgotten. */
  onSimConnect(sourceId) {
    const id = shipOf(sourceId);
    if (id === sourceId && this.ships.has(id) && this.condition(id) !== 'normal') this.sendSim(id, { type: 'ship.condition', args: { level: this.condition(id) } });
  }

  state(id) {
    const s = this.ship(id);
    return { shipId: id, condition: s.condition, scenario: this.runner.status(), log: s.lines.slice(), stardateOffset: s.stardateOffset };
  }

  tick() {
    this.runner.tick(this.now());
  }
}


