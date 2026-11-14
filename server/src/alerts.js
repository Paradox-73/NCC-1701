import mongoose from 'mongoose';
import { EVENTS, ROLES, SOURCES, canSeeGroup, shipOf } from '@ncc/shared/schema.js';
import { Alert } from './models/index.js';

const wire = (a) => ({
  id: String(a._id),
  sourceId: a.sourceId,
  ts: a.ts,
  type: a.type,
  group: a.group ?? null,
  channel: a.channel,
  value: a.value,
  threshold: a.threshold,
  severity: a.severity,
  message: a.message,
  ack: a.ack?.by ? { by: a.ack.by, at: a.ack.at, ...(a.ack.reason && { reason: a.ack.reason }) } : null,
  resolved: a.resolved?.at ? { at: a.resolved.at, reason: a.resolved.reason } : null,
});

/** The room an alert goes to: its channel group's alert room, or `alerts` when it belongs to no group (every role joins it). */
export const alertRoom = (group) => (group ? `alerts:${group}` : 'alerts');

/** The room of sockets that must not see alerts about a source: those whose role does not list it in `ships`. */
export const denyRoom = (sourceId) => `deny:${sourceId}`;

/** Mongo filter for the alerts of the sources a role may see; a source outside the registry (a forged one) is visible to every role. */
export const sourceFilter = (role) => ({ $or: [{ sourceId: { $in: ROLES[role]?.ships ?? [] } }, { sourceId: { $nin: SOURCES.map((s) => s.id) } }] });

/** Stores an alert and broadcasts it to the alert room of its group. */
export function makeAlerts({ io, log, metrics }) {
  const room = (group, sourceId) => io.of('/live').to(alertRoom(group)).except(denyRoom(sourceId));
  let pending = [];
  let timer = null;
  let saving = Promise.resolve(); // every insert still in flight: an ack that comes 1 ms after the timer fired waits for it too
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    const docs = pending;
    pending = [];
    const insert = docs.length ? Alert.insertMany(docs, { ordered: false }).catch((err) => log.error({ err: err.message }, 'alert save failed')) : null;
    if (insert) saving = Promise.all([saving, insert]);
    return saving;
  };
  return {
    flush,
    raise(alert) {
      const doc = { _id: new mongoose.Types.ObjectId(), ...alert };
      metrics.inc('alerts');
      pending.push(doc);
      timer ??= setTimeout(flush, 100); // a burst (The Naked Time raises 503 at once) is one insert, not 503: Atlas M0 allows 100 operations a second
      room(alert.group, alert.sourceId).emit(EVENTS.ALERT, wire(doc));
    },
    /**
     * Marks an alert acknowledged by `user`; returns the updated alert, or null when it is missing, already
     * acknowledged, or the user's role may not acknowledge alerts of its group.
     */
    async ack(id, user) {
      await flush();
      if (!ROLES[user.role]?.canAck) return null;
      const a = await Alert.findOneAndUpdate(
        { _id: id, 'ack.by': { $exists: false }, group: { $in: [...ROLES[user.role].groups, null] }, ...sourceFilter(user.role) },
        { ack: { by: user.username, at: Date.now() } },
        { new: true },
      ).lean();
      if (a) room(a.group, a.sourceId).emit(EVENTS.ALERT_ACK, { id: String(a._id), by: user.username });
      return a;
    },
    /** Acknowledges every open alert the user's role may see and ack; returns how many. */
    async ackAll(user) {
      await flush();
      if (!ROLES[user.role]?.canAck) return 0;
      const filter = { 'ack.by': { $exists: false }, group: { $in: [...ROLES[user.role].groups, null] }, ...sourceFilter(user.role) };
      const docs = await Alert.find(filter, { _id: 1, group: 1, sourceId: 1 }).lean();
      if (!docs.length) return 0;
      await Alert.updateMany({ _id: { $in: docs.map((d) => d._id) }, 'ack.by': { $exists: false } }, { ack: { by: user.username, at: Date.now() } });
      for (const a of docs) room(a.group, a.sourceId).emit(EVENTS.ALERT_ACK, { id: String(a._id), by: user.username });
      return docs.length;
    },
    /** A scenario starts or ends: its ships' open warn and critical alerts are closed and acknowledged as the system, so the next run starts from a clean list. */
    async resolveForShips(shipIds, reason) {
      await flush();
      const sourceIds = SOURCES.filter((s) => shipIds.includes(shipOf(s.id))).map((s) => s.id);
      const docs = await Alert.find({ sourceId: { $in: sourceIds }, severity: { $ne: 'info' }, 'resolved.at': { $exists: false } }, { _id: 1, group: 1, sourceId: 1, 'ack.by': 1 }).lean();
      if (!docs.length) return 0;
      const now = Date.now();
      const ids = docs.map((d) => d._id);
      await Alert.updateMany({ _id: { $in: ids }, 'ack.by': { $exists: false } }, { ack: { by: 'system', at: now, reason } });
      await Alert.updateMany({ _id: { $in: ids } }, { resolved: { at: now, reason } });
      for (const a of docs) if (!a.ack?.by) room(a.group, a.sourceId).emit(EVENTS.ALERT_ACK, { id: String(a._id), by: 'system' });
      return docs.length;
    },
    /** The detector's open conditions live in memory, so alerts left open by a stopped server have nobody watching them: close them, and acknowledge them as the system so every client shows them as seen. */
    async closeStale() {
      const now = Date.now();
      const r = await Alert.updateMany({ severity: { $ne: 'info' }, 'ack.by': { $exists: false } }, { ack: { by: 'system', at: now, reason: 'server restarted' }, resolved: { at: now, reason: 'server restarted' } });
      return r.modifiedCount;
    },
    wire,
    canSee: (user, group) => canSeeGroup(user.role, group),
    room,
  };
}
