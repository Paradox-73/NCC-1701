import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import VirtualList from '../components/VirtualList.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTick } from '../lib/hooks.js';
import { ackAlert, ackAlerts, state } from '../lib/store.js';
import { ago, isOpen, meta, shipCode, stardate } from './parts/data.js';
import { Chip, DivisionPill, Headline, Monitor, Station, useKeys } from '../ui/index.js';
import { C, fmt } from './parts/ui.jsx';

const SEV = { critical: ['crit', 'RED'], warn: ['warn', 'YELLOW'], info: ['info', 'INFO'] };
const FILTERS = [['open', 'Open'], ['red', 'Red'], ['yellow', 'Yellow'], ['all', 'All']];

function AlertList({ shipId }) {
  useTick(500);
  const { user } = useAuth();
  const [filter, setFilter] = useState('open');
  const [busy, setBusy] = useState(null);
  const all = shipId ? state.alerts.filter((a) => a.sourceId === shipId) : state.alerts;
  const list = all.filter((a) => (filter === 'all' ? true : filter === 'open' ? isOpen(a) : filter === 'red' ? a.severity === 'critical' : a.severity === 'warn'));
  const red = all.filter((a) => isOpen(a) && a.severity === 'critical').length, yellow = all.filter((a) => isOpen(a) && a.severity === 'warn').length;
  const ack = async (a) => { setBusy(a.id); await ackAlert(a.id); setBusy(null); };
  const [bulk, setBulk] = useState(null); // { done, total } while acknowledging all, then { ok, failed }
  const unacked = list.filter((a) => !a.ack && !a.resolved);
  const ackAll = async () => {
    const ids = unacked.map((a) => a.id);
    setBulk({ done: 0, total: ids.length });
    const r = await ackAlerts(ids, (done, total) => setBulk({ done, total }));
    setBulk(r);
  };
  const newest = all.find((a) => !a.ack && user?.canAck);
  useKeys({ a: () => newest && ack(newest) });
  const now = Date.now();
  const narrow = !!window.matchMedia?.('(max-width: 640px)')?.matches; // a phone gives each alert two lines of message
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid #ffffff0d' }}>
        <Chip level={red ? 'crit' : 'off'}>{red} RED</Chip>
        <Chip level={yellow ? 'warn' : 'off'}>{yellow} YELLOW</Chip>
        {user?.canAck && (
          <button type="button" className="st-btn" onClick={ackAll} disabled={!unacked.length || bulk?.total != null}>
            {bulk?.total != null ? `ACKNOWLEDGING ${bulk.done} OF ${bulk.total}` : `ACK ALL${unacked.length ? ` ${unacked.length}` : ''}`}
          </button>
        )}
        {bulk?.ok != null && <span className="st-label" role="status">{bulk.ok} acknowledged{bulk.failed ? `, ${bulk.failed} refused` : ''}</span>}
        <div className="st-seg-ctl" role="radiogroup" aria-label="Show" style={{ marginLeft: 'auto' }}>
          {FILTERS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}>{l.toUpperCase()}</button>)}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <VirtualList items={list} rowHeight={narrow ? 104 : 62} label="Alerts" className="st-list" style={{ height: '100%' }}
          empty={<div className="st-blank"><b>ALL QUIET</b><span>{filter === 'open' ? 'No open alerts for the systems your role can see.' : 'Nothing matches this filter.'}</span></div>}
          renderRow={(a) => {
            const [lv, word] = SEV[a.severity] ?? ['info', 'INFO'];
            const fresh = a.arrivedAt && now - a.arrivedAt < 1500;
            return (
              <div className={fresh ? 'st-row new' : 'st-row'} style={{ alignItems: 'flex-start', paddingTop: 9, gap: 10 }}>
                <Chip level={a.ack || a.resolved ? 'off' : lv}>{word}</Chip>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span className={narrow ? 'st-clamp2' : undefined} style={narrow ? { color: a.ack ? C.ink2 : C.ink } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: a.ack ? C.ink2 : C.ink }} title={a.message}>{a.message}</span>
                  <span className={narrow ? 't st-clamp2' : 't'} style={narrow ? undefined : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {shipCode(a.sourceId)} · {meta(a.channel)?.label ?? a.type} · stardate {fmt(stardate(a.ts), 2)} · {ago(now - a.ts)}
                    {a.ack ? ` · seen by ${a.ack.by}` : a.resolved ? ' · cleared' : ''}
                  </span>
                </div>
                {!a.ack && user?.canAck && <button type="button" className="st-btn" onClick={() => ack(a)} disabled={busy === a.id} aria-label={`Acknowledge: ${a.message}`}>{busy === a.id ? '···' : 'ACK'}</button>}
              </div>
            );
          }} />
      </div>
      <p className="st-label" style={{ margin: 0, padding: '8px 12px', borderTop: '1px solid #ffffff0d' }}>Press A to acknowledge the newest alert. Acknowledging tells every console that someone has seen it.</p>
    </div>
  );
}

/**
 * The alerts drawer (DESIGN.md CaptainsLog with acknowledge): `open` and `onClose` make it a drawer over any station;
 * without `open` it renders as a page of its own (the shell's /alerts route).
 */
/**
 * The Alerts station (The 1966 set): open, red and yellow counts as headlines over the captain's log. The log keeps its
 * filters and acknowledgement; the drawer opened from the top bar shows the same log on its own.
 */
function AlertsPage({ shipId }) {
  useTick(500);
  const all = (shipId ? state.alerts.filter((a) => a.sourceId === shipId) : state.alerts).filter(isOpen);
  const red = all.filter((a) => a.severity === 'critical').length, yellow = all.filter((a) => a.severity === 'warn').length;
  return (
    <Station name="Alerts" division="fleet" ship={null} rows="minmax(170px, auto) minmax(360px, 1fr)">
      <Monitor title="Open" status={red ? 'crit' : yellow ? 'warn' : 'ok'} className="st-c4" index={0}>
        <Headline value={all.length} unit="open" word={all.length ? undefined : 'ALL QUIET'} />
      </Monitor>
      <Monitor title="Red" status={red ? 'crit' : 'ok'} className="st-c4" index={1}>
        <Headline value={red} unit="critical" level={red ? 'crit' : null} crit="RED" word={red ? undefined : 'NONE'} />
      </Monitor>
      <Monitor title="Yellow" status={yellow ? 'warn' : 'ok'} className="st-c4" index={2}>
        <Headline value={yellow} unit="warning" level={yellow ? 'warn' : null} warn="YELLOW" word={yellow ? undefined : 'NONE'} />
      </Monitor>
      <Monitor title="Captain's log" meta="alerts your role can see, newest first" className="st-c12" index={3}>
        <AlertList shipId={shipId} />
      </Monitor>
    </Station>
  );
}

export default function Alerts({ open, onClose, shipId }) {
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const back = document.activeElement;
    closeRef.current?.focus();
    const esc = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); back?.focus?.(); };
  }, [open]);
  if (open === undefined) return <AlertsPage shipId={shipId} />;
  if (!open) return null;
  return createPortal(
    <>
      <div className="st-drawer-bg" onClick={onClose} aria-hidden="true" />
      <aside className="st-drawer" role="dialog" aria-modal="true" aria-label="Alerts">
        <header>
          <DivisionPill division="fleet" />
          <h2>ALERTS</h2>
          <button ref={closeRef} type="button" className="st-x" onClick={onClose} aria-label="Close alerts">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </header>
        <AlertList shipId={shipId} />
      </aside>
    </>,
    document.body,
  );
}
