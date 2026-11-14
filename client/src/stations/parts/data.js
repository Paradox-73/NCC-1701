// Station data access: channel metadata and limits from the registry, latest values straight from the store's ring
// buffers, room subscriptions with a history backfill, and the command route. Every lookup tolerates a channel or group
// the registry does not have yet: it reads as "no data", never as an error.
import { useEffect, useState } from 'react';
import { CHANNEL_BY_KEY, GROUP_CHANNELS, RULES, SOURCES } from '@ncc/shared/schema.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useSubscription } from '../../lib/hooks.js';
import { backfill, getRing, state } from '../../lib/store.js';

export const meta = (key) => CHANNEL_BY_KEY[key];
export const hasGroup = (g) => !!GROUP_CHANNELS[g];
export const canSee = (user, g) => !!user?.groups?.includes(g);

// Ships of the task force, without the sickbay hubs (DOMAIN.md: hub id = ship id + 10).
export const SHIPS = SOURCES.filter((s) => (s.kind ? s.kind === 'ship' : s.id <= 10));
export const shipName = (id) => SOURCES.find((s) => s.id === id)?.name ?? `Source ${id}`;
export const shipCode = (id) => SOURCES.find((s) => s.id === id)?.code ?? `#${id}`;

// warn and critical limits per channel and side, from RULES.thresholds
const LIM = {};
for (const r of RULES?.thresholds ?? []) (LIM[r.channel] ??= {})[r.dir] = r;
export const limitsOf = (key) => LIM[key];

/** 'crit', 'warn' or null for a reading against its threshold rules. */
export function levelOf(key, v) {
  const l = LIM[key];
  if (!l || v == null || Number.isNaN(v)) return null;
  if ((l.high && v > l.high.critical) || (l.low && v < l.low.critical)) return 'crit';
  if ((l.high && v > l.high.warn) || (l.low && v < l.low.warn)) return 'warn';
  return null;
}
export const worst = (levels) => (levels.includes('crit') ? 'crit' : levels.includes('warn') ? 'warn' : null);
export const WORD = { crit: 'RED', warn: 'YELLOW' };

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

/** 'live', 'lost' or 'unknown' from the server's 5 Hz overview (bit 0 = sending). */
export function linkOf(src) {
  if (!state.overviewPrimed) return 'unknown';
  return state.overview.get(src)?.flags & 1 ? 'live' : 'lost';
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

// DOMAIN.md deck names (our choice; the show never gave a full deck plan)
export const DECKS = ['Bridge', "Officers' quarters", 'Crew quarters', 'Laboratories', 'Sickbay', 'Recreation', 'Transporter rooms', 'Shuttle hangar', 'Cargo and food stores', 'Life support plant', 'Main engineering', 'Impulse and auxiliary control'];
export const pad2 = (n) => String(n).padStart(2, '0');

/** Stardate as the top bar shows it (DOMAIN.md): ten units a day. */
export const stardate = (ts) => 1000 + (ts - Date.UTC(2026, 0, 1)) / 8_640_000;

/**
 * Commands to a ship (DOMAIN.md section 7). `send` posts it; the button that sent it blinks until the server answers,
 * and `last` holds the answer for the console's status line ("Warp factor 7, aye · 38 ms").
 */
export function useCommand(shipId) {
  const { user } = useAuth();
  const [pending, setPending] = useState(null);
  const [last, setLast] = useState(null);
  const can = (type) => {
    const list = user?.commands;
    return !list || list.some((c) => c === type || (c.endsWith('.*') && type.startsWith(c.slice(0, -1))));
  };
  const send = async (type, payload = {}, say = type) => {
    if (!can(type)) { setLast({ ok: false, text: `${say}: not your station's order` }); return; }
    setPending(type);
    const t0 = performance.now();
    try {
      await api(`/api/ships/${shipId}/command`, { method: 'POST', body: { type, ...payload } });
      setLast({ ok: true, text: `${say}, aye · ${Math.round(performance.now() - t0)} ms` });
    } catch (e) {
      setLast({ ok: false, text: `${say}: ${e.message}` });
    } finally {
      setPending(null);
    }
  };
  return { send, pending, last, can };
}

/** Alerts the role can see for one source, newest first (the store keeps them newest first). */
export const alertsFor = (src) => state.alerts.filter((a) => a.sourceId === src);
export const isOpen = (a) => !a.ack && !a.resolved;
