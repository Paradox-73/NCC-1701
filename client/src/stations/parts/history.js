// History plus live without duplicates (docs/PROTOCOL.md), ported from the earlier pit-wall project's History page.
// Once the server confirms the live room, frames are buffered while the history request runs; samples with
// seq <= lastSeq are dropped, the rest appended, and from then on a live sample is appended only when its seq is above
// the last one drawn. After a reconnect the samples missed while offline are fetched and spliced in by seq.
// The data lives in arrays of its own, not the store's ring, so a 50 Hz source still shows its whole hour.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CHANNEL_BY_KEY } from '@ncc/shared/schema.js';
import { api } from '../../lib/api.js';
import { useSubscription } from '../../lib/hooks.js';
import { onConnection, onFrameRows, state, stats, whenSubscribed } from '../../lib/store.js';

const MAX_POINTS = 8000; // above this the older half is thinned so a long live session stays light

export function useHistory(sourceId, channel, rangeSec, enabled = true) {
  const [meta, setMeta] = useState({ status: 'loading', live: 0, joinTs: null, count: 0, downsampled: false, error: null, filled: 0 });
  const data = useRef({ xs: [], ys: [], seqs: [], ver: 0, joinSeq: 0 });
  const ch = CHANNEL_BY_KEY[channel];
  const group = ch?.group;
  const on = enabled && !!ch && !!sourceId;
  const subscribed = useSubscription(on ? [sourceId] : [], on ? [group] : []);

  useEffect(() => {
    const d = { xs: [], ys: [], seqs: [], ver: 0, joinSeq: 0 };
    data.current = d;
    setMeta({ status: on ? 'loading' : 'off', live: 0, joinTs: null, count: 0, downsampled: false, error: null, filled: 0 });
    if (!on || !subscribed) return undefined;
    const scale = ch.scale;
    let dead = false;
    let loaded = false;
    let lastSeq = 0;
    let live = 0;
    let gap = null; // where the line stopped while the live connection was down
    let droppedWhileLoading = false;
    const joinedFirst = state.status === 'online'; // the room was confirmed before the fetch (see whenSubscribed)
    const buf = [];
    const push = (seq, x, y) => { d.seqs.push(seq); d.xs.push(x); d.ys.push(y); };

    const append = (seq, ts, v) => {
      if (seq <= lastSeq) return;
      lastSeq = seq;
      push(seq, ts / 1000, v);
      live++;
      if (d.xs.length > MAX_POINTS) {
        const keep = 2000, n = d.xs.length - keep;
        const seqs = [], xs = [], ys = [];
        for (let i = 0; i < n; i += 2) { seqs.push(d.seqs[i]); xs.push(d.xs[i]); ys.push(d.ys[i]); }
        d.seqs = seqs.concat(d.seqs.slice(n)); d.xs = xs.concat(d.xs.slice(n)); d.ys = ys.concat(d.ys.slice(n));
      }
      d.ver++;
    };
    const off = onFrameRows((id, g, keys, rows) => {
      if (id !== sourceId || g !== group) return;
      const ki = keys.indexOf(channel) + 2;
      if (ki < 2) return;
      if (!loaded) for (const r of rows) buf.push([r[0], r[1], r[ki]]);
      else for (const r of rows) append(r[0], r[1], r[ki]);
    });

    // samples after `afterSeq` that the socket missed: merged with the live rows that came after them
    const splice = (res, afterSeq) => {
      const ci = res.keys.indexOf(channel) + 2;
      let k = d.seqs.length;
      while (k > 0 && d.seqs[k - 1] > afterSeq) k--;
      const tail = d.seqs.slice(k).map((s, j) => [s, d.xs[k + j], d.ys[k + j]]);
      const have = new Set(tail.map((r) => r[0]));
      const add = res.samples.filter((s) => s[0] > afterSeq && !have.has(s[0])).map((s) => [s[0], s[1] / 1000, s[ci] / scale]);
      if (!add.length) return;
      d.seqs.length = k; d.xs.length = k; d.ys.length = k;
      for (const [s, x, y] of [...tail, ...add].sort((a, b) => a[0] - b[0])) push(s, x, y);
      lastSeq = Math.max(lastSeq, d.seqs[d.seqs.length - 1]); // a frame still carrying one of these must not add it again
      d.ver++;
      stats.gapFilled += add.length;
      setMeta((m) => ({ ...m, filled: m.filled + add.length }));
    };
    const fill = (g) => whenSubscribed([sourceId], [group])
      .then(() => api('/api/telemetry', { query: { sourceId, from: Math.floor(g.ts) - 1, to: Date.now() + 1000, maxPoints: 5000, keys: channel } }))
      .then((res) => { if (!dead) splice(res, g.seq); })
      .catch(() => { if (!gap) gap = g; }); // still unreachable: the next connect tries again
    const offConn = onConnection((s) => {
      if (s === 'offline') {
        if (!loaded) droppedWhileLoading = true;
        else if (!gap) gap = { seq: lastSeq, ts: d.xs.length ? d.xs[d.xs.length - 1] * 1000 : Date.now() };
        return;
      }
      if (!gap || !loaded) return;
      const g = gap;
      gap = null;
      fill(g);
    });

    const to = Date.now() + 1000;
    api('/api/telemetry', { query: { sourceId, from: to - rangeSec * 1000, to, maxPoints: 2000, keys: channel } })
      .then((res) => {
        if (dead) return;
        const ci = res.keys.indexOf(channel) + 2;
        // a hole in stored data (source silent, server stalled) is drawn as a break, not a straight line
        const holeS = Math.max(2, (rangeSec / 2000) * 4);
        for (const s of res.samples) {
          const x = s[1] / 1000;
          if (d.xs.length && x - d.xs[d.xs.length - 1] > holeS) push(d.seqs[d.seqs.length - 1], d.xs[d.xs.length - 1] + 0.001, null);
          push(s[0], x, s[ci] / scale);
        }
        lastSeq = res.lastSeq;
        d.joinSeq = res.lastSeq;
        const joinTs = d.xs.length ? d.xs[d.xs.length - 1] : null;
        loaded = true;
        for (const r of buf) append(r[0], r[1], r[2]);
        buf.length = 0;
        d.ver++;
        // the live connection was down before or during the load: fetch what it missed now, or once it is back
        if (droppedWhileLoading || !joinedFirst) {
          const g = { seq: res.lastSeq, ts: joinTs ? joinTs * 1000 : to - rangeSec * 1000 };
          if (state.status === 'online') fill(g); else gap = g;
        }
        setMeta((m) => ({ ...m, status: 'ready', joinTs, count: res.samples.length, downsampled: !!res.downsampled }));
      })
      .catch((e) => !dead && setMeta((m) => ({ ...m, status: 'error', error: e.message })));
    const tick = setInterval(() => setMeta((m) => (m.live === live ? m : { ...m, live })), 1000);
    return () => { dead = true; off(); offConn(); clearInterval(tick); };
  }, [sourceId, channel, rangeSec, group, subscribed, on]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, meta };
}

/**
 * getData for the house Chart: [xs, stored, live] where stored is grey up to the join and live carries on from the same
 * point, so the colour change is the "live from here" tick. `split: false` gives one series. Null when nothing changed.
 */
export function useHistoryData(data, deps, split = true) {
  return useMemo(() => {
    let seen = -1, at = 0;
    return () => {
      const d = data.current;
      const now = performance.now();
      if (d.ver === seen || now - at < 200) return null;
      seen = d.ver; at = now;
      if (!d.xs.length) return null;
      if (!split) return [d.xs, d.ys];
      const j = d.joinSeq ? d.seqs.findIndex((s) => s > d.joinSeq) : -1;
      const n = d.xs.length;
      const cut = j < 0 ? n : j;
      const hist = new Array(n), live = new Array(n);
      for (let i = 0; i < n; i++) { hist[i] = i < cut ? d.ys[i] : null; live[i] = i >= cut - 1 ? d.ys[i] : null; }
      if (cut === n) live.fill(null);
      return [d.xs, hist, live];
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
