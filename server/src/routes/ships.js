import { Router } from 'express';
import { z } from 'zod';
import { SHIP_IDS, SOURCE_BY_ID, canSeeSource, roleMayCommand } from '@ncc/shared/schema.js';
import { SCENARIO_LIST } from '@ncc/shared/scenarios/index.js';
import { HttpError, int, parse } from '../middleware/index.js';
import { TokenBucket } from '../ingest/tokenBucket.js';
import { COMMAND_SCHEMA } from '../ships/commands.js';

const idParam = z.object({ id: int(1, 99) });

/** Ship state, shipboard commands and scenarios. See docs/PROTOCOL.md for the payloads. */
export function shipRoutes({ world, ingest }) {
  const r = Router();
  const buckets = new Map(); // username -> 10 commands a second, burst 20
  const ship = (req) => {
    const { id } = parse(idParam, req.params);
    if (!SHIP_IDS.includes(id)) throw new HttpError(404, 'no such ship');
    if (!canSeeSource(req.user.role, id)) throw new HttpError(403, `role ${req.user.role} may not see ship ${id}`);
    return id;
  };

  r.get('/ships', (req, res) => {
    res.json({ ships: SHIP_IDS.filter((id) => canSeeSource(req.user.role, id)).map((id) => ({ shipId: id, name: SOURCE_BY_ID[id].name, code: SOURCE_BY_ID[id].code, condition: world.condition(id), online: ingest.sockets.has(id) })) });
  });
  r.get('/ships/:id/state', (req, res) => res.json(world.state(ship(req))));

  r.post('/ships/:id/command', (req, res) => {
    const shipId = ship(req);
    const cmd = parse(COMMAND_SCHEMA, req.body);
    if (!roleMayCommand(req.user.role, cmd.type)) throw new HttpError(403, `role ${req.user.role} may not send ${cmd.type}`);
    let bucket = buckets.get(req.user.username);
    if (!bucket) buckets.set(req.user.username, (bucket = new TokenBucket(10, 20)));
    if (!bucket.take(1)) throw new HttpError(429, 'too many commands');
    const { ok, at, text } = world.execute(shipId, cmd, { username: req.user.username, role: req.user.role });
    res.json({ ok, at, text });
  });

  r.get('/scenarios', (_req, res) => res.json({ scenarios: SCENARIO_LIST, status: world.runner.status() }));
  return r;
}
