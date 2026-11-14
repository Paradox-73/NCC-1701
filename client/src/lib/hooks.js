import { useEffect, useReducer, useState } from 'react';
import { subscribe, whenSubscribed } from './store.js';

// Re-render the calling component at most once per `ms` (default 4 times a second).
// Frames land in ring buffers outside React; components read the buffers on this tick. Every component
// ticks off one shared 250 ms clock, so a page and its parts re-render together in one batched render:
// never more than 4 renders a second however many components tick.
const tickers = new Set();
let beats = 0;
let clock = null;
export function useTick(ms = 250) {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const t = { every: Math.max(1, Math.round(ms / 250)), bump };
    tickers.add(t);
    if (!clock) clock = setInterval(() => { beats++; for (const x of tickers) if (beats % x.every === 0) x.bump(); }, 250);
    return () => { tickers.delete(t); if (!tickers.size) { clearInterval(clock); clock = null; } };
  }, [ms]);
}

// Join live rooms while mounted. Several components may ask for the same room; the manager counts them.
// Returns true once the server has confirmed the rooms for exactly these sources and groups.
export function useSubscription(sourceIds, groups) {
  const key = JSON.stringify([sourceIds, groups]);
  const [readyKey, setReadyKey] = useState(null);
  useEffect(() => {
    const [c, g] = JSON.parse(key);
    if (!c.length || !g.length) return undefined;
    let live = true;
    const off = subscribe(c, g);
    whenSubscribed(c, g).then(() => live && setReadyKey(key));
    return () => { live = false; off(); };
  }, [key]);
  return readyKey === key;
}
