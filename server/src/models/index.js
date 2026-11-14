import mongoose from 'mongoose';
import { ROLES } from '@ncc/shared/schema.js';

const { Schema } = mongoose;

export const Source = mongoose.model(
  'Source',
  new Schema({ sourceId: { type: Number, unique: true }, name: String, code: String }, { collection: 'sources' }),
);

export const User = mongoose.model(
  'User',
  new Schema(
    {
      username: { type: String, unique: true },
      passwordHash: String,
      role: { type: String, enum: Object.keys(ROLES) },
    },
    { collection: 'users' },
  ),
);

export const Device = mongoose.model(
  'Device',
  new Schema({ sourceId: { type: Number, unique: true }, lastSeq: Number, lastSeenAt: Date }, { collection: 'devices' }),
);

const alertSchema = new Schema(
  {
    sourceId: Number,
    ts: Number,
    type: String,
    group: String, // channel group of the alert's channel; null (e.g. link loss) means every role may see it
    channel: String,
    value: Number,
    threshold: Number,
    severity: { type: String, enum: ['info', 'warn', 'critical'] },
    message: String,
    ack: { by: String, at: Number, reason: String },
    resolved: { at: Number, reason: String }, // closed by the system, not by a person: the condition is gone or its server stopped watching it
    createdAt: { type: Date, default: Date.now }, // the TTL index on this field expires old alerts (see ensureAlertsTtl)
  },
  { collection: 'alerts', versionKey: false },
);
alertSchema.index({ sourceId: 1, ts: -1 });
export const Alert = mongoose.model('Alert', alertSchema);
