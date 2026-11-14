import { SOURCES } from '@ncc/shared/schema.js';
import { ButtonGrid, DivisionPill, Jewel, STATUS_WORD, cx } from './controls.jsx';

/** A jewel-row entry: a system's worst level, or off while its monitor shows no live data. */
export const J = (label, level, monitorState) => ({ label, status: monitorState !== 'live' ? 'off' : level || 'ok' });

/**
 * The console strip along the bottom of a station: real controls on the left (children), the decorative button
 * grid, then a labelled jewel per system (`jewels`: [{ label, status }]). Below 1024 px it is a bottom bar of controls.
 */
export function ConsoleStrip({ children, jewels = [], seed = 1, className }) {
  return (
    <div className={cx('console-strip', className)} role="group" aria-label="Console controls">
      <div className="console-strip__controls">{children}</div>
      <ButtonGrid rows={3} cols={40} seed={seed} className="console-strip__grid" />
      {jewels.length > 0 && (
        <div className="jewel-row">
          {jewels.map((j) => (
            <span key={j.label} className="jewel-row__item"><Jewel status={j.status} label={`${j.label}: ${STATUS_WORD[j.status]}`} /><span aria-hidden="true">{j.label}</span></span>
          ))}
        </div>
      )}
    </div>
  );
}

const shipOf = (id) => SOURCES.find((s) => s.id === id);

/**
 * The console frame every station uses: a placard (division pill, station name, ship), the recessed bank of monitors
 * on a 12-column grid with `rows` as its row template, and the desk (a ConsoleStrip) along the bottom.
 */
export function Station({ name, division, ship, rows, end, desk, children }) {
  const s = ship != null && shipOf(ship);
  return (
    <div className="st-station" data-station={name.toLowerCase()}>
      <header className="st-plate">
        <DivisionPill division={division} />
        <h1>{name}</h1>
        {ship != null && <span className="st-ship">{s?.code ?? `#${ship}`} · {s?.name ?? `Source ${ship}`}</span>}
        {end && <span className="st-plate-end">{end}</span>}
      </header>
      <div className="st-grid" style={rows ? { '--rows': rows } : undefined}>{children}</div>
      {desk}
    </div>
  );
}
