// Limit lookups from the registry's threshold rules, so a reading knows when it is past warn or critical.
import { CHANNEL_BY_KEY, RULES } from '@ncc/shared/schema.js';

const RULES_BY_CHANNEL = {};
for (const r of RULES.thresholds) (RULES_BY_CHANNEL[r.channel] ||= []).push(r);

/** 'ok' | 'warn' | 'crit' for a value of a channel, or 'off' when there is no value. */
export function levelOf(key, v) {
  if (v == null || Number.isNaN(v)) return 'off';
  let level = 'ok';
  for (const r of RULES_BY_CHANNEL[key] ?? []) {
    const past = (limit) => (r.dir === 'high' ? v > limit : v < limit);
    if (past(r.critical)) return 'crit';
    if (past(r.warn)) level = 'warn';
  }
  return level;
}

/** The normal band of a channel, [lo, hi], from its warn limits and its range. */
export function bandOf(key) {
  const c = CHANNEL_BY_KEY[key];
  if (!c) return null;
  let lo = c.min;
  let hi = c.max;
  for (const r of RULES_BY_CHANNEL[key] ?? []) {
    if (r.dir === 'high') hi = Math.min(hi, r.warn);
    else lo = Math.max(lo, r.warn);
  }
  return lo === c.min && hi === c.max ? null : [lo, hi];
}

export const LEVEL_WORD = { warn: 'YELLOW', crit: 'RED' };
const worse = { off: 0, ok: 1, warn: 2, crit: 3 };
/** The most serious of several levels. */
export const worst = (levels) => levels.reduce((a, b) => (worse[b] > worse[a] ? b : a), 'off');
