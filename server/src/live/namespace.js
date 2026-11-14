import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { EVENTS, GROUPS, LIMITS, ROLES, roleGroups } from '@ncc/shared/schema.js';
import { alertRoom } from '../alerts.js';
import { TokenBucket } from '../ingest/tokenBucket.js';

const sourceIds = z.array(z.number().int().min(1).max(LIMITS.maxSourceId)).max(LIMITS.maxSourceId);
const group = z.enum(GROUPS);
const subscribeSchema = z.object({ sourceIds, groups: z.array(group).max(GROUPS.length).optional() });
const unsubscribeSchema = z.object({ sourceIds, groups: z.array(group).optional() });
const ackSchema = z.object({ id: z.string().regex(/^[0-9a-f]{24}$/) });

/**
 * Dashboards. The role from the JWT decides everything: the groups a user may subscribe to, the alert rooms they join
 * and whether they may acknowledge. Rooms are `src:<id>:<group>`, `overview`, `alerts`, `alerts:<group>` and `admin`.
 */
export function setupLive({ io, config, metrics, alerts, log }) {
  const nsp = io.of('/live');

  nsp.use((socket, next) => {
    try {
      const p = jwt.verify(String(socket.handshake.auth?.token ?? ''), config.jwtSecret);
      if (!ROLES[p.role]) throw new Error('unknown role');
      socket.data.user = { id: p.sub, username: p.username, role: p.role };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  nsp.on('connection', (socket) => {
    const user = socket.data.user;
    const allowed = roleGroups(user.role);
    const bucket = new TokenBucket(20, 40); // protects against subscribe storms
    socket.conn.on('packetCreate', (p) => metrics.inc('bytesOut', p.data?.length ?? 0));
    socket.join(['overview', 'alerts', ...allowed.map(alertRoom)]);
    if (ROLES[user.role].admin) socket.join('admin');

    const guard = (fn) => async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!bucket.take(1)) return reply({ ok: false, error: 'rate limited' });
      try {
        await fn(payload, reply);
      } catch (err) {
        if (err instanceof z.ZodError) reply({ ok: false, error: 'invalid payload' });
        else {
          log.error({ err: err.message }, 'live handler failed');
          reply({ ok: false, error: 'server error' });
        }
      }
    };

    socket.on(
      EVENTS.SUBSCRIBE,
      guard((payload, reply) => {
        const { sourceIds: ids, groups = allowed } = subscribeSchema.parse(payload);
        const denied = groups.filter((g) => !allowed.includes(g));
        const rooms = [];
        for (const id of ids) {
          for (const g of groups) {
            if (denied.includes(g)) continue;
            rooms.push(`src:${id}:${g}`);
            socket.join(`src:${id}:${g}`);
          }
        }
        reply({ ok: true, rooms, denied });
      }),
    );

    socket.on(
      EVENTS.UNSUBSCRIBE,
      guard((payload, reply) => {
        const { sourceIds: ids, groups = GROUPS } = unsubscribeSchema.parse(payload);
        for (const id of ids) for (const g of groups) socket.leave(`src:${id}:${g}`);
        reply({ ok: true });
      }),
    );

    socket.on(
      EVENTS.ALERT_ACK,
      guard(async (payload, reply) => {
        if (!ROLES[user.role].canAck) return reply({ ok: false, error: 'read only' });
        const a = await alerts.ack(ackSchema.parse(payload).id, user);
        reply({ ok: !!a });
      }),
    );
  });
  return nsp;
}
