import { Router } from 'express';
import { z } from 'zod';
import { LIMITS } from '@ncc/shared/schema.js';
import { HttpError, int, parse, requireCap } from '../middleware/index.js';

// The command channel to a simulated source. `type` names the command; scenario scripts decide which types exist
// and what `args` mean. The server only checks the shape, relays it, and resets the detector on `clear`.
const command = z.object({
  type: z.string().regex(/^[a-z][a-z0-9:_-]{0,39}$/),
  args: z.record(z.string(), z.any()).optional(),
});

export function adminRoutes({ metrics, ingest, detector }) {
  const r = Router();
  r.get('/metrics', requireCap('admin'), (_req, res) => res.json(metrics.snapshot()));
  r.post('/sim/:sourceId/command', requireCap('admin'), (req, res) => {
    const { sourceId } = parse(z.object({ sourceId: int(1, LIMITS.maxSourceId) }), req.params);
    const cmd = parse(command, req.body);
    if (!ingest.sendCommand(sourceId, cmd)) throw new HttpError(409, 'source is not connected');
    if (cmd.type === 'clear') detector.reset(sourceId);
    res.json({ ok: true, sourceId, command: cmd });
  });
  return r;
}
