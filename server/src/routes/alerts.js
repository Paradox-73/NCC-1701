import { Router } from 'express';
import { z } from 'zod';
import { LIMITS, SOURCE_BY_ID, canSeeSource, roleGroups } from '@ncc/shared/schema.js';
import { sourceFilter } from '../alerts.js';
import { Alert } from '../models/index.js';
import { HttpError, assertGroup, bool, int, parse, requireCap } from '../middleware/index.js';

const idParam = z.object({ id: z.string().regex(/^[0-9a-f]{24}$/) });
const query = z.object({
  sourceId: int(1, LIMITS.maxSourceId).optional(),
  since: z.coerce.number().int().min(0).optional(),
  unacked: bool.optional(),
  limit: int(1, 500).default(100),
});

/** Alert history and acknowledgement. A role sees alerts of its groups plus those tied to no group (link loss). */
export function alertRoutes({ alerts }) {
  const r = Router();
  r.get('/alerts', async (req, res) => {
    const q = parse(query, req.query);
    const filter = { group: { $in: [...roleGroups(req.user.role), null] }, ...sourceFilter(req.user.role) };
    if (q.sourceId) filter.sourceId = q.sourceId;
    if (q.since) filter.ts = { $gt: q.since };
    if (q.unacked) filter['ack.by'] = { $exists: false };
    const docs = await Alert.find(filter).sort({ ts: -1 }).limit(q.limit).lean();
    res.json({ alerts: docs.map(alerts.wire) });
  });
  r.post('/alerts/ack-all', requireCap('canAck'), async (req, res) => {
    res.json({ acked: await alerts.ackAll(req.user) });
  });
  r.post('/alerts/:id/ack', requireCap('canAck'), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const existing = await Alert.findById(id).lean();
    if (!existing) throw new HttpError(404, 'alert not found');
    if (existing.group) assertGroup(req.user, existing.group);
    if (SOURCE_BY_ID[existing.sourceId] && !canSeeSource(req.user.role, existing.sourceId)) throw new HttpError(403, 'role may not see that source');
    const a = await alerts.ack(id, req.user);
    res.json({ alert: alerts.wire(a ?? existing), alreadyAcked: !a });
  });
  return r;
}
