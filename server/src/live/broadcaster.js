import { CONDITIONS, EVENTS, GROUP_CHANNELS, ROLES, SHIP_IDS, canSeeGroup, channelIndex, groupsOf, isCrewSource } from '@ncc/shared/schema.js';

// Column of each group's channels in a packed sample, per source kind (the first ship and the first crew hub stand for their kind)
const IDX = Object.fromEntries([1, 11].map((id) => [isCrewSource(id) ? 'crew' : 'ship', Object.fromEntries(groupsOf(id).map((g) => [g, GROUP_CHANNELS[g].map((k) => channelIndex(id)[k])]))]));
const kindName = (sourceId) => (isCrewSource(sourceId) ? 'crew' : 'ship');

/** A role's view of the overview: only the ships it may see, with the helm columns (warp, position, heading) blank without the helm group and the shield column blank without the shields group. */
export function rowsForRole(rows, role) {
  const helm = canSeeGroup(role, 'helm'), shields = canSeeGroup(role, 'shields');
  return rows.filter((r) => ROLES[role].ships.includes(r[0])).map(([id, flags, cond, warp, shield, x, y, heading]) => [id, flags, cond, helm ? warp : 0, shields ? shield : 0, helm ? x : 0, helm ? y : 0, helm ? heading : 0]);
}

/**
 * Owns the frame loop (FRAME_MS), the 200 ms overview and the 1 Hz metrics emit.
 * Accepted samples are queued per source; each tick sends, for every room that has
 * listeners, only that group's columns of only the samples that are new.
 */
export class Broadcaster {
  constructor({ io, config, metrics, states, detector, world }) {
    this.nsp = io.of('/live');
    this.config = config;
    this.metrics = metrics;
    this.states = states;
    this.detector = detector;
    this.world = world;
    this.pending = new Map(); // sourceId -> packed samples since the last tick
    this.rxCount = 0; // samples accepted since the last metrics tick
    this.rxRate = 0; // samples accepted per second, over the last metrics tick
    this.timers = [];
  }

  enqueue(sourceId, packed) {
    let q = this.pending.get(sourceId);
    if (!q) this.pending.set(sourceId, (q = []));
    q.push(packed);
    this.rxCount++;
  }

  start() {
    const every = (ms, fn) => this.timers.push(setInterval(fn, ms).unref());
    every(this.config.frameMs, () => this.sendFrames());
    every(this.config.overviewMs, () => this.sendOverview());
    every(this.config.metricsMs, () => this.sendMetrics());
  }

  stop() {
    this.timers.forEach(clearInterval);
  }

  sendFrames() {
    const rooms = this.nsp.adapter.rooms;
    const now = Date.now();
    for (const [sourceId, q] of this.pending) {
      this.pending.delete(sourceId);
      q.sort((a, b) => a[0] - b[0]);
      let emitted = false;
      const idxOf = IDX[kindName(sourceId)];
      for (const group of groupsOf(sourceId)) {
        const room = `src:${sourceId}:${group}`;
        const listeners = rooms.get(room)?.size;
        if (!listeners) continue;
        const idx = idxOf[group];
        const samples = q.map((s) => [s[0], s[1], ...idx.map((i) => s[i])]);
        this.nsp.to(room).emit(EVENTS.FRAME, { sourceId, group, keys: GROUP_CHANNELS[group], samples });
        this.metrics.inc('framesOut');
        this.metrics.inc('framesDelivered', listeners);
        emitted = true;
      }
      if (emitted) for (const s of q) this.metrics.observeLatency(now - s[1]);
    }
  }

  /**
   * One row per ship the server has heard from, including ones that went quiet (online bit off, last known values):
   * [sourceId, flags, condition, warp*100, weakest shield*10, posX*10, posY*10, heading*10]. Volatile: a slow client
   * drops it instead of queueing it. Only the registry's ships get a row; crew hubs have none and their ship's row carries the alert flags.
   */
  sendOverview() {
    const rows = this.overviewRows();
    for (const role of Object.keys(ROLES)) {
      if (!this.nsp.adapter.rooms.get(`overview:${role}`)?.size) continue;
      this.nsp.to(`overview:${role}`).volatile.emit(EVENTS.OVERVIEW, { ts: Date.now(), sources: rowsForRole(rows, role), rx: this.rxRate });
    }
  }

  overviewRows() {
    const rows = [];
    for (const id of SHIP_IDS) {
      const c = this.states.sources.get(id);
      if (!c?.v) continue;
      const sev = this.detector.openSeverity(id);
      const v = c.v;
      const shield = Math.min(v.shieldFore, v.shieldAft, v.shieldPort, v.shieldStbd);
      const cond = Math.max(0, CONDITIONS.indexOf(this.world?.condition(id) ?? 'normal'));
      rows.push([id, (this.states.isActive(c) ? 1 : 0) | (sev >= 2 ? 2 : 0) | (sev >= 3 ? 4 : 0), cond, Math.round(v.warpFactor * 100), Math.round(shield * 10), Math.round(v.posX * 10), Math.round(v.posY * 10), Math.round(v.heading * 10)]);
    }
    return rows;
  }

  sendMetrics() {
    this.rxRate = Math.round(this.rxCount * (1000 / this.config.metricsMs));
    this.rxCount = 0;
    this.metrics.tick();
    if (this.nsp.adapter.rooms.get('admin')?.size) this.nsp.to('admin').emit(EVENTS.METRICS, this.metrics.snapshot());
  }
}
