import { useEffect, useMemo, useRef } from 'react';
import { play } from '../lib/sound.js';

export const cx = (...a) => a.filter(Boolean).join(' ');

/** The 4 x 16 px division mark next to a station or role name. division: command | science | ops | fleet */
export const DivisionPill = ({ division }) => <i className="pill" data-division={division} aria-hidden="true" />;

export const KeyCap = ({ children }) => <kbd className="keycap">{children}</kbd>;

/**
 * A real control: a translucent lit rectangle with a Michroma label and a key cap.
 * color: red | amber | yellow | green | blue | white (DESIGN.md lit-button table)
 * lit: steady on. pressed: a toggle's state (sets aria-pressed). pending: blinks twice a second until the server acks.
 */
export function LitButton({ color = 'blue', label, keyCap, lit, pressed, pending, size, className, onClick, children, ...rest }) {
  const flash = useRef(null);
  const press = (e) => {
    const el = flash.current;
    if (el) { el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); } // restart the white-core flash
    play('press');
    onClick?.(e);
  };
  return (
    <button type="button" className={cx('lit', `lit--${color}`, size && `lit--${size}`, lit && 'is-lit', pending && 'is-pending', className)}
      aria-pressed={pressed} aria-busy={pending || undefined} onClick={press} {...rest}>
      <span className="lit__flash" aria-hidden="true" />
      {label ?? children}
      {keyCap && <KeyCap>{keyCap}</KeyCap>}
    </button>
  );
}

export const STATUS_WORD = { ok: 'nominal', info: 'information', warn: 'yellow alert', crit: 'red alert', off: 'no signal' };

/** A small round lamp. status: ok | info | warn | crit | off. Always labelled, by text beside it or by `label`. */
export const Jewel = ({ status = 'ok', label, size }) => (
  <i className={cx('jewel', size === 'lg' && 'jewel--lg')} data-status={status} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
);

/** A status word on a small plate: YELLOW, LOADED, LINK. level: warn | crit | ok | info | off. */
export const Chip = ({ level, children }) => <span className="chip" data-level={level}>{children}</span>;

/**
 * The word that always goes with a status colour: YELLOW or RED (or the `warn` and `crit` words given). While nominal
 * it shows the `ok` word if there is one (HOLDING, OPEN), and with no reading the `off` word if there is one.
 */
export function LevelChip({ level, warn = 'YELLOW', crit = 'RED', ok, off }) {
  if (level === 'warn' || level === 'crit') return <Chip level={level}>{level === 'crit' ? crit : warn}</Chip>;
  const word = level === 'off' ? off : level === 'ok' ? ok : null;
  return word ? <Chip level={level}>{word}</Chip> : null;
}

/** A black label plate with white capitals: how the set names a station or a screen. `as` sets the element (h2, span). */
export const LabelPlate = ({ as: Tag = 'span', className, children, ...rest }) => <Tag className={cx('plate', className)} {...rest}>{children}</Tag>;

/**
 * Real controls on a black desk plate: LitButtons in a row that wraps, the row's name (`label`) on a small plate under
 * it and for screen readers. Only real buttons go on a plate; decorative lights never do.
 */
export function ButtonRow({ label, className, children }) {
  return (
    <div className={cx('btnrow', className)} role="group" aria-label={label}>
      <div className="btnrow__keys">{children}</div>
      {label && <span className="btnrow__caption" aria-hidden="true">{label}</span>}
    </div>
  );
}

// Small seeded generator, so a grid keeps its pattern across renders and reloads.
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const LAMP_COLORS = ['red', 'amber', 'yellow', 'green', 'blue', 'white'];

/**
 * Decorative rows of jellybeans that light up in a pattern. aria-hidden; CSS animations only.
 * In yellow alert they turn amber and yellow, in red alert red only and blinking in step (ui.css).
 */
export function ButtonGrid({ rows = 3, cols = 12, seed = 1, colors = LAMP_COLORS, booting, delay = 0, className }) {
  const lamps = useMemo(() => {
    const r = rng(seed * 7919 + 13);
    return Array.from({ length: rows * cols }, () => {
      const lit = r() < 0.55; // the rest stay dim
      return {
        c: `var(--lit-${colors[Math.floor(r() * colors.length)]})`,
        d: lit ? `${(1.5 + r() * 4.5).toFixed(2)}s` : '0s',
        o: `${(-r() * 6).toFixed(2)}s`,
      };
    });
  }, [rows, cols, seed, colors]);
  return (
    <div className={cx('grid-lamps', booting && 'is-booting', className)} style={{ '--rows': rows, '--delay': `${delay}ms` }} aria-hidden="true">
      {lamps.map((l, i) => <i key={i} style={{ '--c': l.c, '--d': l.d, '--o': l.o }} />)}
    </div>
  );
}

// one jellybean lens at the origin, as on the set: a round dome, a square block or a long faceted gem
const LENS = {
  dome: (p) => <circle r="5.6" {...p} />,
  block: (p) => <rect x="-7.6" y="-5.2" width="15.2" height="10.4" rx="2" {...p} />,
  gem: (p) => <polygon points="-9,0 -6,-5 6,-5 9,0 6,5 -6,5" {...p} />,
};
const SHINE = { dome: <circle cx="-1.8" cy="-1.9" r="1.7" className="jb__shine" />, block: <rect x="-6.4" y="-4.3" width="12.8" height="2.6" rx="1.2" className="jb__shine" />, gem: <polygon points="-5.2,-4 5.2,-4 3.9,-2.2 -3.9,-2.2" className="jb__shine" /> };
const polarPt = (cx, cy, r, deg) => [cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180)];

/**
 * A fan-shaped black plate of jellybean lenses, the desk buttons of the set (RESEARCH.md, Bridge consoles). aria-hidden
 * set dressing that holds still; in yellow alert the lenses turn amber and yellow, in red alert red (ui.css).
 */
export function JellybeanPlate({ seed = 1, className }) {
  const { plate, gems } = useMemo(() => {
    const r = rng(seed * 7919 + 101);
    const C = 320, A = 16, [ox0, oy0] = polarPt(100, C, 310, -A), [ox1, oy1] = polarPt(100, C, 310, A), [ix1, iy1] = polarPt(100, C, 248, A), [ix0, iy0] = polarPt(100, C, 248, -A);
    const out = [];
    for (const rad of [297, 279, 261]) {
      for (let a = -13; a <= 13.1; a += 4.3) {
        if (r() < 0.18) continue;
        const [x, y] = polarPt(100, C, rad, a + (r() - 0.5) * 0.8);
        out.push({ x, y, a, kind: ['dome', 'block', 'gem'][Math.floor(r() * 3)], c: `var(--lit-${LAMP_COLORS[Math.floor(r() * LAMP_COLORS.length)]})`, lit: r() < 0.5 });
      }
    }
    return { plate: `M${ox0} ${oy0} A310 310 0 0 1 ${ox1} ${oy1} L${ix1} ${iy1} A248 248 0 0 0 ${ix0} ${iy0} Z`, gems: out };
  }, [seed]);
  return (
    <svg className={cx('jb', className)} viewBox="0 6 200 82" aria-hidden="true">
      <path className="jb__plate" d={plate} />
      {gems.map((g, i) => (
        <g key={i} transform={`translate(${g.x.toFixed(1)} ${g.y.toFixed(1)}) rotate(${g.a.toFixed(1)})`} style={{ '--c': g.c }}>
          {LENS[g.kind]({ className: 'jb__gem' })}
          {g.lit && LENS[g.kind]({ className: 'jb__lit' })}
          {SHINE[g.kind]}
        </g>
      ))}
    </svg>
  );
}

/** Flickers its child monitor once when `value` changes (the tube flicker in DESIGN.md Motion). */
export function useFlicker(value) {
  const ref = useRef(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = ref.current;
    if (!el) return;
    el.classList.remove('is-flicker'); void el.offsetWidth; el.classList.add('is-flicker');
  }, [value]);
  return ref;
}
