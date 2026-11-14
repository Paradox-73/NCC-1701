import mongoose from 'mongoose';
import { EVENTS, ROLES, canSeeGroup } from '@ncc/shared/schema.js';
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

/** Stores an alert and broadcasts it to the alert room of its group. */
export function makeAlerts({ io, log, metrics }) {
  const room = (group) => io.of('/live').to(alertRoom(group));
  return {
    raise(alert) {
      const doc = { _id: new mongoose.Types.ObjectId(), ...alert };
      metrics.inc('alerts');
      Alert.create(doc).catch((err) => log.error({ err: err.message }, 'alert save failed'));
      room(alert.group).emit(EVENTS.ALERT, wire(doc));
    },
    /**
     * Marks an alert acknowledged by `user`; returns the updated alert, or null when it is missing, already
     * acknowledged, or the user's role may not acknowledge alerts of its group.
     */
    async ack(id, user) {
      if (!ROLES[user.role]?.canAck) return null;
      const a = await Alert.findOneAndUpdate(
        { _id: id, 'ack.by': { $exists: false }, group: { $in: [...ROLES[user.role].groups, null] } },
        { ack: { by: user.username, at: Date.now() } },
        { new: true },
      ).lean();
      if (a) room(a.group).emit(EVENTS.ALERT_ACK, { id: String(a._id), by: user.username });
      return a;
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
