import { Router } from 'express';
import { z } from 'zod';
import { CHANNEL_BY_KEY, CHANNELS, GROUPS, GROUP_CHANNELS, LIMITS, canSeeGroup } from '@ncc/shared/schema.js';
import { HttpError, assertGroup, int, parse } from '../middleware/index.js';

// the dashboard asks for one hour at most; a longer span (from=0) made MongoDB sort up to a day of a source's samples per request
const MAX_SPAN_MS = 3600_000;
const query = z.object({
  sourceId: int(1, LIMITS.maxSourceId),
  from: z.coerce.number().int().min(0).optional(),
  to: z.coerce.number().int().min(0).optional(),
  maxPoints: int(10, 5000).default(2000),
  keys: z.string().optional(),
  group: z.enum(GROUPS).optional(),
});

/** History for one source: raw samples when they fit in maxPoints, otherwise $bucketAuto downsampling in MongoDB. Only channels of the caller's groups are returned. */
export function telemetryRoutes({ getTelemetry, writer }) {
  const r = Router();
  r.get('/telemetry', async (req, res) => {
    const q = parse(query, req.query);
    if (q.group) assertGroup(req.user, q.group);
    const to = q.to ?? Date.now() + 1000;
    const from = q.from ?? to - 60_000;
    if (to - from > MAX_SPAN_MS) throw new HttpError(400, 'from and to may be at most one hour apart');
    const visible = (key) => canSeeGroup(req.user.role, CHANNEL_BY_KEY[key].group);
    const wanted = q.keys ? q.keys.split(',').filter((k) => CHANNEL_BY_KEY[k]) : q.group ? GROUP_CHANNELS[q.group] : CHANNELS.map((c) => c.key);
    const keys = wanted.filter(visible);
    if (!keys.length) return res.status(wanted.length ? 403 : 400).json({ error: wanted.length ? 'no channel of yours in that request' : 'no valid keys' });

    const col = getTelemetry();
    const match = { sourceId: q.sourceId, ts: { $gte: new Date(from), $lt: new Date(to) } };
    // accepted samples not in MongoDB yet were already broadcast, possibly before this client subscribed: include them,
    // reading them before the query so a flush that finishes meanwhile cannot hide them from both
    const unwritten = writer.unwritten().filter((d) => d.sourceId === q.sourceId && d.ts >= match.ts.$gte && d.ts < match.ts.$lt);
    const count = await col.countDocuments(match);
    const downsampled = count > q.maxPoints;
    let docs;
    if (downsampled) {
      // each bucket keeps its newest sample (max seq), so lastSeq is exact; buckets is count / (whole samples per point), so MongoDB
      // fills them evenly instead of rounding the size down and pouring the remainder into the newest bucket
      const rows = await col
        .aggregate([
          { $match: match },
          { $bucketAuto: { groupBy: '$ts', buckets: Math.ceil(count / Math.ceil(count / q.maxPoints)), output: { top: { $top: { sortBy: { seq: -1 }, output: '$$ROOT' } } } } },
        ])
        .toArray();
      docs = rows.map((b) => b.top);
    } else {
      docs = await col.find(match).sort({ seq: 1 }).toArray();
    }
    const stored = new Set(docs.map((d) => d.seq));
    for (const d of unwritten) if (!stored.has(d.seq)) docs.push(d);
    docs.sort((a, b) => a.seq - b.seq);
    const scale = keys.map((k) => CHANNEL_BY_KEY[k].scale);
    const samples = docs.map((d) => [d.seq, d.ts.getTime(), ...keys.map((k, i) => Math.round(d[k] * scale[i]))]);
    res.json({ sourceId: q.sourceId, keys, samples, lastSeq: docs.length ? docs[docs.length - 1].seq : 0, downsampled, count });
  });
  return r;
}
