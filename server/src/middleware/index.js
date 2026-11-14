import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ROLES, canSeeGroup } from '@ncc/shared/schema.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const limiter = (limit, options = {}) =>
  rateLimit({ windowMs: 60_000, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too many requests' }, ...options });

export const requireAuth = (secret) => (req, _res, next) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) throw new HttpError(401, 'missing token');
  try {
    const p = jwt.verify(m[1], secret);
    if (!ROLES[p.role]) throw new Error('unknown role');
    req.user = { id: p.sub, username: p.username, role: p.role };
  } catch {
    throw new HttpError(401, 'invalid token');
  }
  next();
};

/** Passes only users whose role has the given capability flag in the registry ('admin', 'canAck'). */
export const requireCap = (cap) => (req, _res, next) => {
  if (!ROLES[req.user.role]?.[cap]) throw new HttpError(403, 'forbidden');
  next();
};

/** Throws 403 when the user's role may not see the channel group. */
export const assertGroup = (user, group) => {
  if (!canSeeGroup(user.role, group)) throw new HttpError(403, `role ${user.role} may not see ${group}`);
};

export const parse = (schema, data) => schema.parse(data);

// query strings arrive as strings: coerce numbers and booleans
export const int = (min, max) => z.coerce.number().int().min(min).max(max);
export const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export function errorHandler(log) {
  return (err, _req, res, _next) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'invalid request', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'malformed JSON' });
    if (err.name === 'CastError') return res.status(400).json({ error: 'invalid id' });
    // body-parser (413 body too large, 415 charset) and the router (400 undecodable parameter) give client errors a status
    if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.expose ? err.message : 'bad request' });
    log.error({ err: err.message, stack: err.stack }, 'request failed');
    res.status(500).json({ error: 'internal error' });
  };
}
