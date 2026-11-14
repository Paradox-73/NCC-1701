import { useEffect, useRef, useState } from 'react';
import Chart from '../components/Chart.jsx';
import VirtualList from '../components/VirtualList.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTick } from '../lib/hooks.js';
import { getRing } from '../lib/store.js';
import { crewHubOf, crewLabel, deckOfCrew } from '@ncc/shared/schema.js';
import { DECK_NAMES, canSee, levelOf, meta, monState, pad2, read, useCommand, useFeed, worst } from './parts/data.js';
import { useHistory, useHistoryData } from './parts/history.js';
import { Chip, ConsoleStrip, J, LevelChip, LitButton, Monitor, Num, Station } from '../ui/index.js';
import { C, calmRange, clamp, fmt, useCanvas } from './parts/ui.jsx';

// DOMAIN.md section 4: crew 001-012 on deck 1, then 38 a deck; four vitals each, one group per deck on the crew hub
const pad3 = (n) => String(n).padStart(3, '0');
const DECK_OF = deckOfCrew;
const BY_DECK = Array.from({ length: 12 }, (_, d) => Array.from({ length: 430 }, (_, i) => i + 1).filter((n) => DECK_OF(n) === d + 1));
const BIO = BY_DECK.map((_, d) => `bio-d${pad2(d + 1)}`);
// `sd`: the spread one standard deviation stands for on the grid (our choice), so resting noise stays under 1
const VITALS = [
  { v: 'hr', label: 'Heart rate', unit: 'bpm', lo: 30, hi: 180, sd: 6 },
  { v: 'rr', label: 'Respiration', unit: '/min', lo: 4, hi: 40, sd: 2 },
  { v: 'bt', label: 'Body temperature', unit: '°C', lo: 33, hi: 42, sd: 0.3, dec: 1 },
  { v: 'nr', label: 'Neural activity', unit: '%', lo: 30, hi: 200, sd: 8 },
];
const CLS = [C.raised, C.dev1, C.warn, C.crit]; // under 1, 1-2, 2-3, over 3 standard deviations (DESIGN.md heatmap)
const MEDICAL = 'Medical records: CMO and captain only.';
// the overview lists ships only, so a crew hub counts as silent when its newest sample is over 5 s old
const seen = new Map(); // hub -> { seq, at }: when this browser last saw the newest sample change
const isStale = (hub) => {
  const r = getRing(hub, BIO[0]);
  if (!r?.len) return false;
  const s = seen.get(hub);
  if (!s || s.seq !== r.lastSeq) { seen.set(hub, { seq: r.lastSeq, at: Date.now() }); return false; }
  return Date.now() - s.at > 5000;
};
const who = (n) => `${crewLabel(n)} · ${DECK_NAMES[DECK_OF(n) - 1]}`;

/** Each crew member's own baseline per vital: the median of what the store holds (up to 600 samples), refreshed every 15 s. */
function useBaselines(hub) {
  const base = useRef(new Map());
  useEffect(() => {
    const buf = new Float64Array(600);
    const run = () => {
      for (const g of BIO) {
        const r = getRing(hub, g);
        if (!r?.len) continue;
        const n = Math.min(r.len, 600);
        for (const k of r.keys) {
          const col = r.cols[k];
          for (let i = 0; i < n; i++) buf[i] = col[(r.head - n + i + r.cap * 2) % r.cap];
          base.current.set(k, buf.subarray(0, n).sort()[n >> 1]);
        }
      }
    };
    const timers = [setTimeout(run, 2500), setTimeout(run, 7000), setInterval(run, 15000)];
    return () => timers.forEach((t) => clearTimeout(t));
  }, [hub]);
  return base;
}

/** { cls: -1 no signal | 0..3, z, dom (the vital furthest from baseline), v } for one crew member. */
function crewStatus(hub, base, n, stale) {
  const r = getRing(hub, BIO[DECK_OF(n) - 1]);
  if (stale || !r?.len || !r.cols[`hr_${pad3(n)}`]) return { cls: -1, z: 0 };
  let z = 0, lim = 0, dom = VITALS[0], dv = r.last(`hr_${pad3(n)}`);
  for (const x of VITALS) {
    const k = `${x.v}_${pad3(n)}`, v = r.last(k), b = base.get(k);
    const zz = b == null ? 0 : Math.abs(v - b) / x.sd;
    const l = levelOf(k, v), ln = l === 'crit' ? 3 : l === 'warn' ? 2 : 0;
    if (zz > z || ln > lim) { dom = x; dv = v; }
    z = Math.max(z, zz); lim = Math.max(lim, ln);
  }
  return { cls: Math.max(lim, z >= 3 ? 3 : z >= 2 ? 2 : z >= 1 ? 1 : 0), z, dom, v: dv };
}

/** 430 cells grouped by deck, coloured by distance from each person's baseline; hover shows the person, click selects. */
function CrewGrid({ hub, base, sel, onSel }) {
  const [tip, setTip] = useState(null);
  const geo = useRef(null);
  const ref = useCanvas((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const stale = isStale(hub);
    const L = w < 520 ? 26 : 112, cols = 38, gap = w < 520 ? 1.5 : 3;
    const cell = Math.max(4, Math.min(18, (w - L - 12) / cols - gap, (h - 16) / 12 - gap - 1));
    const rowH = cell + gap + 1, top = Math.max(8, (h - rowH * 12) / 2);
    geo.current = { L, cell, gap, rowH, top };
    ctx.font = `400 ${w < 520 ? 9 : 10}px "Space Mono", monospace`; ctx.textBaseline = 'middle';
    BY_DECK.forEach((crew, d) => {
      const y = top + d * rowH;
      ctx.fillStyle = C.mute; ctx.textAlign = 'left';
      ctx.fillText(w < 520 ? pad2(d + 1) : `${pad2(d + 1)} ${DECK_NAMES[d].split(' ')[0]}`, 4, y + cell / 2);
      crew.forEach((n, i) => {
        const x = L + i * (cell + gap), s = crewStatus(hub, base.current, n, stale);
        if (s.cls < 0) {
          ctx.fillStyle = C.void; ctx.fillRect(x, y, cell, cell);
          ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + cell); ctx.lineTo(x + cell, y); ctx.stroke();
        } else {
          ctx.fillStyle = CLS[s.cls]; ctx.fillRect(x, y, cell, cell);
          if (s.cls >= 2) { ctx.shadowColor = CLS[s.cls]; ctx.shadowBlur = 6; ctx.fillRect(x, y, cell, cell); ctx.shadowBlur = 0; }
        }
        if (n === sel) { ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(x - 1.5, y - 1.5, cell + 3, cell + 3); }
      });
    });
  }, [hub, sel], 250);
  const at = (e) => {
    const g = geo.current;
    if (!g) return null;
    const b = e.currentTarget.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    const d = Math.floor((y - g.top) / g.rowH), i = Math.floor((x - g.L) / (g.cell + g.gap));
    const n = BY_DECK[d]?.[i];
    return n ? { n, x, y, w: b.width } : null;
  };
  const move = (dn) => onSel(clamp((sel ?? 1) + dn, 1, 430));
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={ref} className="st-canvas" tabIndex={0} role="img" style={{ cursor: 'pointer' }}
        aria-label={`Crew biosign grid, 430 crew by deck. ${sel ? `Selected: ${who(sel)}.` : ''} Arrow keys move the selection.`}
        onMouseMove={(e) => setTip(at(e))} onMouseLeave={() => setTip(null)} onClick={(e) => { const p = at(e); if (p) onSel(p.n); }}
        onKeyDown={(e) => { const k = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 38, ArrowUp: -38 }[e.key]; if (k) { e.preventDefault(); move(k); } }} />
      {tip && (() => {
        const s = crewStatus(hub, base.current, tip.n, isStale(hub));
        return (
          <div className="chart-tip" style={{ display: 'block', left: tip.x > tip.w - 220 ? tip.x - 214 : tip.x + 14, top: tip.y + 14, pointerEvents: 'none', minWidth: 190 }}>
            <div className="t">{who(tip.n)}</div>
            {VITALS.map((x) => { const k = `${x.v}_${pad3(tip.n)}`, v = getRing(hub, BIO[DECK_OF(tip.n) - 1])?.last?.(k); return <div className="r" key={x.v}><span style={{ color: C.mute, minWidth: 110 }}>{x.label}</span><b style={{ color: levelOf(k, v) === 'crit' ? C.critInk : levelOf(k, v) === 'warn' ? C.warn : C.ink }}>{fmt(v, x.dec ?? 0)}</b><span>{x.unit}</span></div>; })}
            <div className="r"><span style={{ color: C.mute, minWidth: 110 }}>From baseline</span><b>{fmt(s.z, 1)}σ</b></div>
          </div>
        );
      })()}
    </div>
  );
}

/** The sickbay bed display: a vertical scale per vital with a pointer arrow, and a dot pulsing at the live heart rate. */
function Biobed({ hub, n }) {
  if (!n) return <div className="st-blank"><b>NO PATIENT</b><span>Select a crew member on the grid or the watch list.</span></div>;
  const r = getRing(hub, BIO[DECK_OF(n) - 1]);
  const hr = r?.last?.(`hr_${pad3(n)}`);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '10px 12px', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ font: '400 11px var(--font-display)', letterSpacing: '0.08em' }}>CREW {pad3(n)}</span>
        <span className="st-label">{crewLabel(n).split(' · ').slice(1).join(' · ')} · {DECK_NAMES[DECK_OF(n) - 1]}</span>
        <i aria-hidden="true" className="sb-beat" style={{ marginLeft: 'auto', animationDuration: `${Math.max(0.5, 60 / clamp(hr ?? 60, 20, 220))}s` }} title={`Pulses at the heart rate, ${fmt(hr, 0)} bpm`} />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        {VITALS.map((x) => {
          const k = `${x.v}_${pad3(n)}`, v = r?.last?.(k), lv = levelOf(k, v);
          const f = v == null ? 0 : clamp((v - x.lo) / (x.hi - x.lo));
          return (
            <div key={x.v} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <span className="st-label" style={{ textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{x.label}</span>
              <div style={{ position: 'relative', flex: 1, minHeight: 80, width: 18, borderRadius: 3, background: 'linear-gradient(180deg, #ff4a5533, #ffffff08 22%, #ffffff12 50%, #ffffff08 78%, #2f6fae33)', boxShadow: 'inset 0 0 0 1px #ffffff14' }} role="meter" aria-label={`${x.label} ${fmt(v, x.dec ?? 0)} ${x.unit}`} aria-valuenow={v ?? undefined} aria-valuemin={x.lo} aria-valuemax={x.hi}>
                {[0.25, 0.5, 0.75].map((q) => <i key={q} style={{ position: 'absolute', left: -4, right: -4, bottom: `${q * 100}%`, borderTop: '1px solid #ffffff22' }} />)}
                <div style={{ position: 'absolute', inset: 0, transform: `translateY(${(1 - f) * 100}%)`, transition: 'transform 600ms cubic-bezier(0.2,0,0,1)' }}>
                  <i style={{ position: 'absolute', right: -14, top: -6, width: 0, height: 0, borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderRight: `10px solid ${lv === 'crit' ? C.crit : lv === 'warn' ? C.warn : C.chart1}` }} />
                </div>
              </div>
              <span style={{ font: '700 15px var(--font-mono)', color: lv === 'crit' ? C.critInk : lv === 'warn' ? C.warn : C.ink }}>{fmt(v, x.dec ?? 0)}</span>
              <span className="st-unit" style={{ margin: 0 }}>{x.unit}</span>
              <LevelChip level={lv} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Trend({ hub, k, label, unit, dec }) {
  const { data } = useHistory(hub, k, 600, !!meta(k));
  const getData = useHistoryData(data, [hub, k]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
      <Chart key={k} fill x="time" title={`${label} (${unit})`} legend={false} sync="crew" unit={unit} getData={getData} yRange={calmRange(k)}
        series={[{ label: 'Stored', color: C.mute, dec, unit }, { label: 'Live', color: C.chart1, dec, unit }]} />
    </div>
  );
}

/** Sickbay (DESIGN.md "Sickbay"): CMO and captain only. The crew grid, the watch list, the biobed and vital trends. */
export default function Sickbay({ shipId = 1 }) {
  useTick();
  const { user } = useAuth();
  const hub = crewHubOf(shipId) ?? shipId + 10; // DOMAIN.md: the crew hub of ship N has id N + 10
  useFeed(hub, BIO, 180000);
  useFeed(shipId, ['crewsummary']);
  const base = useBaselines(hub);
  const [sel, setSel] = useState(null);
  const cmd = useCommand(shipId);
  const medical = canSee(user, BIO[0]);
  const stBio = monState(user, hub, BIO);
  const stale = isStale(hub);
  const all = medical ? BY_DECK.flat().map((n) => ({ n, ...crewStatus(hub, base.current, n, stale) })) : [];
  const watch = all.filter((c) => c.cls >= 2).sort((a, b) => b.cls - a.cls || b.z - a.z);
  const shown = sel ?? watch[0]?.n ?? null; // until someone is picked, the bed shows the crew member furthest from baseline
  const deckOfInterest = shown ? DECK_OF(shown) : null;
  const counts = [0, 1, 2, 3].map((c) => all.filter((x) => x.cls === c).length);
  const sumState = monState(user, shipId, ['crewsummary']);
  const desk = (
    <ConsoleStrip seed={43} jewels={[J('BIOSIGNS', counts[3] ? 'crit' : counts[2] ? 'warn' : null, stBio), J('CREW', worst(['crewWatch', 'crewCritical'].map((k) => levelOf(k, read(shipId, k)))), sumState)]}>
      <LitButton color="green" label="Inoculate" onClick={() => cmd.send('medical.inoculate')} {...cmd.bind('medical.inoculate')} />
      <LitButton color="yellow" label={deckOfInterest ? `Quarantine deck ${pad2(deckOfInterest)}` : 'Quarantine deck'} onClick={() => cmd.send('medical.quarantine', { deck: deckOfInterest })} {...cmd.bind('medical.quarantine')} disabled={!deckOfInterest || !cmd.can('medical.quarantine')} />
    </ConsoleStrip>
  );

  return (
    <Station name="Sickbay" division="science" ship={shipId} rows="minmax(250px, 1.25fr) minmax(220px, 1fr)" desk={desk}
      end={medical ? `${fmt(counts[2] + counts[3], 0)} over 2σ · ${fmt(counts[3], 0)} over 3σ` : null}>
      <Monitor title="Crew biosigns" meta="430 crew · by deck · distance from own baseline" state={stBio} restricted={MEDICAL} className="st-c8" style={{ '--mh': '300px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}><CrewGrid hub={hub} base={base} sel={shown} onSel={setSel} /></div>
          <div className="st-legend" style={{ padding: '4px 12px 8px' }}>
            {['under 1σ', '1-2σ', '2-3σ YELLOW', 'over 3σ RED'].map((l, i) => <span key={l}><i style={{ background: CLS[i] }} />{l}</span>)}
            <span><i style={{ background: C.void, boxShadow: 'inset 0 0 0 1px #ffffff33' }} />no signal</span>
          </div>
        </div>
      </Monitor>
      <Monitor title="Watch list" meta="over 2σ from baseline" state={sumState} className="st-c4" style={{ '--mh': '320px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <dl className="st-kv" style={{ gridTemplateColumns: 'repeat(4, auto 1fr)', padding: '10px 12px', gap: '6px 8px', borderBottom: '1px solid #ffffff0d' }}>
            <dt>Aboard</dt><dd style={{ fontSize: 14 }}><Num value={read(shipId, 'crewAboard')} className="" /></dd>
            <dt>Watch</dt><dd style={{ fontSize: 14 }}><Num value={read(shipId, 'crewWatch')} className="" level={levelOf('crewWatch', read(shipId, 'crewWatch'))} /> <LevelChip level={levelOf('crewWatch', read(shipId, 'crewWatch'))} /></dd>
            <dt>Critical</dt><dd style={{ fontSize: 14 }}><Num value={read(shipId, 'crewCritical')} className="" level={levelOf('crewCritical', read(shipId, 'crewCritical'))} /> <LevelChip level={levelOf('crewCritical', read(shipId, 'crewCritical'))} /></dd>
            <dt>Mean HR</dt><dd style={{ fontSize: 14 }}><Num value={read(shipId, 'crewMeanHr')} dec={0} className="" /><span className="st-unit">bpm</span></dd>
          </dl>
          {!medical ? <div style={{ position: 'relative', flex: 1 }}><div className="st-blank"><b>RESTRICTED</b><span>Counts only. {MEDICAL}</span></div></div> : (
            <div style={{ flex: 1, minHeight: 0 }}>
              <VirtualList items={watch.map((c) => ({ ...c, id: c.n }))} rowHeight={40} label="Crew on medical watch" className="st-list" style={{ height: '100%' }}
                empty={<div className="st-blank"><b>ALL CLEAR</b><span>Nobody is more than 2 standard deviations from their own baseline.</span></div>}
                renderRow={(c) => (
                  <button type="button" className="st-row" onClick={() => setSel(c.n)} aria-pressed={shown === c.n}
                    style={{ width: '100%', border: 0, cursor: 'pointer', textAlign: 'left', background: shown === c.n ? C.raised : 'transparent' }}>
                    <span style={{ font: '700 13px var(--font-mono)' }}>{pad3(c.n)}</span>
                    <span className="t">D{pad2(DECK_OF(c.n))}</span>
                    <span className="m">{c.dom.label} <b style={{ fontFamily: 'var(--font-mono)' }}>{fmt(c.v, c.dom.dec ?? 0)}</b> <span className="st-unit">{c.dom.unit}</span></span>
                    <span className="t">{fmt(c.z, 1)}σ</span>
                    <Chip level={c.cls === 3 ? 'crit' : 'warn'}>{c.cls === 3 ? 'RED' : 'YELLOW'}</Chip>
                  </button>
                )} />
            </div>
          )}
        </div>
      </Monitor>
      <Monitor title="Biobed" meta={shown ? `crew ${pad3(shown)}${sel ? '' : ' · furthest from baseline'}` : 'no patient'} state={stBio} restricted={MEDICAL} className="st-c4" style={{ '--mh': '300px' }}>
        <Biobed hub={hub} n={shown} />
      </Monitor>
      <Monitor title="Vital trends" meta={shown ? `crew ${pad3(shown)} · last 10 minutes · grey stored, blue live` : 'select a crew member'} state={stBio} restricted={MEDICAL} className="st-c8" style={{ '--mh': '680px' }}>
        {shown ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gridAutoRows: 'minmax(0, 1fr)', gap: 10, height: '100%', padding: 10 }}>
            {VITALS.map((x) => <Trend key={`${shown}${x.v}`} hub={hub} k={`${x.v}_${pad3(shown)}`} label={x.label} unit={x.unit} dec={x.dec ?? 0} />)}
          </div>
        ) : <div className="st-blank"><b>NO PATIENT</b><span>Trends load from history when you pick someone on the grid.</span></div>}
      </Monitor>
    </Station>
  );
}
