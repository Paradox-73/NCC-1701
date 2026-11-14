// Station data access: channel metadata and limits from the registry, latest values straight from the store's ring
// buffers, room subscriptions with a history backfill, and the command route. Every lookup tolerates a channel or group
// the registry does not have yet: it reads as "no data", never as an error.
import { useEffect } from 'react';
import { CHANNEL_BY_KEY, GROUP_CHANNELS, SOURCES } from '@ncc/shared/schema.js';
import { useAuth } from '../../lib/auth.jsx';
import { mayCommand, refuseCommand, sendCommand, usePending } from '../../lib/commands.js';
import { useSubscription } from '../../lib/hooks.js';
import { backfill, getRing, state } from '../../lib/store.js';

export const meta = (key) => CHANNEL_BY_KEY[key];
/** "12 s ago", "5 min ago", "3 h ago" for a duration in ms. */
export const ago = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s ago` : ms < 3600000 ? `${Math.round(ms / 60000)} min ago` : `${Math.round(ms / 3600000)} h ago`);
export const hasGroup = (g) => !!GROUP_CHANNELS[g];
export const canSee = (user, g) => !!user?.groups?.includes(g);

// Ships of the task force, without the sickbay hubs (DOMAIN.md: hub id = ship id + 10).
export const SHIPS = SOURCES.filter((s) => (s.kind ? s.kind === 'ship' : s.id <= 10));
export const shipName = (id) => SOURCES.find((s) => s.id === id)?.name ?? `Source ${id}`;
export const shipCode = (id) => SOURCES.find((s) => s.id === id)?.code ?? `#${id}`;

/** 'crit', 'warn' or null for a reading against its threshold rules; limitsOf gives the rules by side. */
export { alarmOf as levelOf, limitsOf } from '../../lib/limits.js';
export const worst = (levels) => (levels.includes('crit') ? 'crit' : levels.includes('warn') ? 'warn' : null);

export const ringOf = (src, key) => { const c = CHANNEL_BY_KEY[key]; return c ? getRing(src, c.group) : undefined; };
/** Latest value of a channel, or undefined while nothing has arrived (or the registry lacks the channel). */
export function read(src, key) {
  const r = ringOf(src, key);
  return r?.len && r.cols[key] ? r.last(key) : undefined;
}
/** Calls fn(slot) for the ring slots of the last `ms` milliseconds, oldest first, without copying the ring. */
export function eachSlot(r, ms, fn, step = 1) {
  if (!r?.len) return 0;
  const end = r.lastTs;
  let n = 0;
  while (n < r.len && end - r.ts[(r.head - 1 - n + r.cap * 2) % r.cap] <= ms) n++;
  for (let i = 0; i < n; i += step) fn((r.head - n + i + r.cap * 2) % r.cap);
  return n;
}
/** Calls fn(ts, value) for one channel over the last `ms` milliseconds. */
export function eachRecent(r, key, ms, fn, step = 1) {
  const col = r?.cols[key];
  return col ? eachSlot(r, ms, (i) => fn(r.ts[i], col[i]), step) : 0;
}
/** Value `ms` ago (the oldest sample inside that span), for change arrows. */
export function readAgo(src, key, ms) {
  let v;
  eachRecent(ringOf(src, key), key, ms, (t, x) => { if (v === undefined) v = x; }, 1e9);
  return v;
}

/** 'live', 'lost' or 'unknown' from the server's 5 Hz overview (bit 0 = sending). The overview lists ships only. */
export function linkOf(src) {
  if (!state.overviewPrimed || !SHIPS.some((s) => s.id === src)) return 'unknown';
  return state.overview.get(src)?.flags & 1 ? 'live' : 'lost';
}

/** 'normal', 'yellow' or 'red' from the widened overview row (the shell's store keeps it), or null before the server sends it. */
export const conditionOf = (src) => state.overview.get(src)?.condition ?? null;
/** Worst open alert from the overview flags: 'crit', 'warn' or null. */
export const alertFlagOf = (src) => { const f = state.overview.get(src)?.flags ?? 0; return f & 4 ? 'crit' : f & 2 ? 'warn' : null; };
/** { x, y, heading, warp } from the overview row when it carries them, else from the helm room's ring; null when unknown. */
export function posOf(src) {
  const o = state.overview.get(src);
  if (o?.x != null) return { x: o.x, y: o.y, heading: o.heading, warp: o.warp };
  const r = ringOf(src, 'posX');
  if (!r?.len || Date.now() - r.lastTs > 5000) return null;
  return { x: r.last('posX'), y: r.last('posY'), heading: r.last('heading'), warp: r.last('warpFactor') };
}

/** What a monitor fed by these groups should show: 'restricted', 'awaiting', 'nosignal' or 'live'. */
export function monState(user, src, groups) {
  if (!groups.every((g) => canSee(user, g))) return 'restricted';
  if (!groups.every(hasGroup)) return 'awaiting';
  const rings = groups.map((g) => getRing(src, g));
  const link = linkOf(src);
  if (rings.some((r) => !r?.len)) return link === 'lost' ? 'nosignal' : 'awaiting';
  if (link === 'lost' && Date.now() - Math.max(...rings.map((r) => r.lastTs)) > 3000) return 'nosignal';
  return 'live';
}

/**
 * Joins the live rooms of `groups` on `src` that exist in the registry and that the role may see, then fills the rings
 * with the last `ms` of history (one request per group, so a deck of crew channels stays a short URL).
 */
export function useFeed(src, groups, ms = 120000) {
  const { user } = useAuth();
  const gs = groups.filter((g) => hasGroup(g) && canSee(user, g));
  const key = gs.join(',');
  const ready = useSubscription(gs.length ? [src] : [], gs);
  useEffect(() => {
    if (!ready || !key) return;
    for (const g of key.split(',')) backfill(src, [g], ms).catch(() => { /* live data still flows */ });
  }, [ready, src, key, ms]);
  return ready;
}

export const pad2 = (n) => String(n).padStart(2, '0');
export { DECK_NAMES, stardate } from '@ncc/shared/schema.js';

/**
 * Commands to a ship (DOMAIN.md section 7), through the shell's command path: the button bound to a type blinks while
 * any order of that type is in flight, and the shell's feedback line shows the server's answer or the refusal.
 */
export function useCommand(shipId) {
  const { user } = useAuth();
  const pending = usePending();
  const can = (type) => mayCommand(user, type);
  /** Resolves true when the server acknowledged the command. */
  const send = async (type, payload = {}) => {
    if (!can(type)) { refuseCommand(type, payload, 'not an order this role may give'); return false; }
    return (await sendCommand(type, payload, shipId)).ok;
  };
  /** Props for the LitButton that sends `type`: blinks while in flight, disabled when the role may not send it. */
  const bind = (type) => ({ pending: pending(type), disabled: !can(type), title: can(type) ? undefined : 'Not an order this role may give' });
  return { send, pending, can, bind };
}

/** Alerts the role can see for one source, newest first (the store keeps them newest first). */
export const alertsFor = (src) => state.alerts.filter((a) => a.sourceId === src);
export const isOpen = (a) => !a.ack && !a.resolved;
