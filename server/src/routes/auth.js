import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ROLES } from '@ncc/shared/schema.js';
import { User } from '../models/index.js';
import { HttpError, limiter, parse, requireAuth } from '../middleware/index.js';

const loginSchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(128) });
const DUMMY_HASH = bcrypt.hashSync('not-a-password', 10); // keeps timing equal for unknown users

// the user object clients get: identity plus what the role may do (label, groups, canAck, admin) from the registry
const publicUser = (u) => ({ ...u, ...ROLES[u.role] });

export function authRoutes({ config }) {
  const r = Router();
  // only failed attempts count: several people signing in to the demo accounts from one network are not guessing passwords
  r.post('/auth/login', limiter(config.loginRateLimit, { skipSuccessfulRequests: true }), async (req, res) => {
    const { username, password } = parse(loginSchema, req.body);
    const u = await User.findOne({ username }).lean();
    const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY_HASH);
    if (!u || !ok) throw new HttpError(401, 'wrong username or password');
    const user = { id: String(u._id), username: u.username, role: u.role };
    const token = jwt.sign({ sub: user.id, username: user.username, role: user.role }, config.jwtSecret, { expiresIn: '12h' });
    res.json({ token, user: publicUser(user) });
  });
  r.get('/auth/me', requireAuth(config.jwtSecret), (req, res) => res.json({ user: publicUser(req.user) }));
  r.get('/health', (_req, res) => {
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    const mongo = states[mongoose.connection.readyState] ?? 'unknown';
    res.status(mongo === 'connected' ? 200 : 503).json({ ok: mongo === 'connected', mongo, uptimeSec: Math.round(process.uptime()) });
  });
  return r;
}
