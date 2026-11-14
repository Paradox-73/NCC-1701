import { SOURCES } from '@ncc/shared/schema.js';
import { DivisionPill, Jewel, JellybeanPlate, ReadoutWindows, cx } from './controls.jsx';

/** A jewel-row entry: a system's worst level, or off while its monitor shows no live data. */
export const J = (label, level, monitorState) => ({ label, status: monitorState !== 'live' ? 'off' : level || 'ok' });

// the word a system window shows beside its lamp; a nominal system shows only the steady dim lamp
const WORD = { warn: 'YELLOW', crit: 'RED', off: 'NO SIGNAL', info: 'INFO' };
// the backlit grilles of the kick panel under the desk, in the set's colours
const GRILLES = ['#e46bd8', '#ffb347', '#f4f7fa', '#5fe08a', '#7fd4ff'];

/**
 * The console you sit at: the readout band (a window per system in `jewels`: [{ label, status }], live readouts in
 * `readouts`: [{ label, value, unit }], then backlit decorative windows), the black desk with the real controls
 * (children) on a plate beside the jellybean plates, the red desk edge and the kick panel (RESEARCH.md, Bridge
 * consoles). Below 1024 px it is a bottom bar with every control.
 */
export function ConsoleStrip({ children, jewels = [], readouts = [], seed = 1, className }) {
  return (
    <div className={cx('console-strip', className)} role="group" aria-label="Console controls">
      <div className="cs-band">
        {jewels.length > 0 && (
          <ul className="cs-status" aria-label="Systems">
            {jewels.map((j) => (
              <li key={j.label} className="cs-status__win" data-status={j.status}>
                <Jewel status={j.status} />
                {j.label}
                {WORD[j.status] ? <span className="cs-status__word">{WORD[j.status]}</span> : <span className="sr-only">nominal</span>}
              </li>
            ))}
          </ul>
        )}
        {readouts.length > 0 && (
          <dl className="cs-readouts">
            {readouts.map((r) => <div key={r.label} className="cs-readout"><dt>{r.label}</dt><dd>{r.value}{r.unit ? <span className="unit">{r.unit}</span> : null}</dd></div>)}
          </dl>
        )}
        <ReadoutWindows seed={seed} />
      </div>
      <div className="cs-desk">
        <div className="console-strip__controls">{children}</div>
        <div className="cs-plates" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <JellybeanPlate key={i} seed={seed * 4 + i} />)}
        </div>
      </div>
      <div className="cs-edge" aria-hidden="true" />
      <div className="cs-kick" aria-hidden="true">{GRILLES.map((g) => <i key={g} style={{ '--g': g }} />)}</div>
    </div>
  );
}

const shipOf = (id) => SOURCES.find((s) => s.id === id);

/**
 * The station frame: the grey wall with a placard (division pill, station name, ship), the screens in their bays on a
 * 12-column grid with `rows` as its row template, and the console (`desk`, a ConsoleStrip) along the bottom.
 */
export function Station({ name, division, ship, rows, end, desk, children }) {
  const s = ship != null && shipOf(ship);
  return (
    <div className="st-station" data-station={name.toLowerCase()}>
      <header className="st-plate">
        <div className="st-sign">
          <DivisionPill division={division} />
          <h1>{name}</h1>
          {ship != null && <span className="st-ship">{s?.code ?? `#${ship}`} · {s?.name ?? `Source ${ship}`}</span>}
        </div>
        {end && <span className="st-plate-end">{end}</span>}
      </header>
      <div className="st-grid" style={rows ? { '--rows': rows } : undefined}>{children}</div>
      {desk}
    </div>
  );
}
