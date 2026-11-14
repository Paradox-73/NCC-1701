import { Router } from 'express';
import { SOURCES } from '@ncc/shared/schema.js';
import { Source } from '../models/index.js';

/** The registry's sources with whether each is sending now. */
export function sourceRoutes({ states }) {
  const r = Router();
  r.get('/sources', async (_req, res) => {
    const docs = await Source.find().sort({ sourceId: 1 }).lean();
    const hz = Object.fromEntries(SOURCES.map((s) => [s.id, s.hz]));
    res.json({
      sources: docs.map((d) => {
        const live = states.sources.get(d.sourceId);
        return { sourceId: d.sourceId, name: d.name, code: d.code, hz: hz[d.sourceId] ?? null, online: !!live && states.isActive(live), lastSeq: live?.seq ?? 0 };
      }),
    });
  });
  return r;
}
