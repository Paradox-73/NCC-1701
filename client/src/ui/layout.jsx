import { ButtonGrid, Jewel, cx } from './controls.jsx';

/**
 * The console strip along the bottom of a station: real controls on the left (children), then the decorative
 * button grid and a jewel row (`jewels`: [{ label, status }]). Below 1024 px it becomes a bottom bar of controls.
 */
export function ConsoleStrip({ children, jewels = [], seed = 1, className }) {
  return (
    <div className={cx('console-strip', className)}>
      <div className="console-strip__controls" role="toolbar" aria-label="Station controls">{children}</div>
      <div className="console-strip__deco">
        <ButtonGrid rows={3} cols={14} seed={seed} />
        {jewels.length > 0 && (
          <div className="jewel-row">
            {jewels.map((j) => <Jewel key={j.label} status={j.status} label={`${j.label}: ${j.status}`} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The frame every station screen shares: a 12-column monitor area and the console strip.
 * Give each monitor a `style={{ gridColumn: 'span 6' }}` (or a class) to place it.
 */
export function StationLayout({ console: controls, jewels, seed, children, className }) {
  return (
    <div className={cx('station', className)}>
      <div className="station__monitors">{children}</div>
      <ConsoleStrip jewels={jewels} seed={seed}>{controls}</ConsoleStrip>
    </div>
  );
}
