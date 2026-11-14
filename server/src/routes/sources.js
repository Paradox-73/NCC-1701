import { Router } from 'express';
import { SOURCES, canSeeSource } from '@ncc/shared/schema.js';
import { Source } from '../models/index.js';

/** The registry's sources with whether each is sending now. */
export function sourceRoutes({ states }) {
  const r = Router();
  r.get('/sources', async (req, res) => {
    const docs = (await Source.find().sort({ sourceId: 1 }).lean()).filter((d) => canSeeSource(req.user.role, d.sourceId));
    const hz = Object.fromEntries(SOURCES.map((s) => [s.id, s.hz]));
    const by = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
    res.json({
      sources: docs.map((d) => {
        const live = states.sources.get(d.sourceId);
        return { sourceId: d.sourceId, kind: by[d.sourceId]?.kind ?? 'ship', ship: by[d.sourceId]?.ship ?? d.sourceId, name: d.name, code: d.code, hz: hz[d.sourceId] ?? null, online: !!live && states.isActive(live), lastSeq: live?.seq ?? 0 };
      }),
    });
  });
  return r;
}
