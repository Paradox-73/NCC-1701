import { useEffect, useMemo, useRef, useState } from 'react';
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
      <span className="lit__flash" ref={flash} aria-hidden="true" />
      {label ?? children}
      {keyCap && <KeyCap>{keyCap}</KeyCap>}
    </button>
  );
}

/** A small round lamp. status: ok | info | warn | crit | off. Always labelled, by text beside it or by `label`. */
export const Jewel = ({ status = 'ok', label, size }) => (
  <i className={cx('jewel', size === 'lg' && 'jewel--lg')} data-status={status} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
);

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

/** True once, for a short while after mount: lets a screen play its power-up animation. */
export function usePowerOn(ms = 1400) {
  const [on, setOn] = useState(true);
  useEffect(() => { const t = setTimeout(() => setOn(false), ms); return () => clearTimeout(t); }, [ms]);
  return on;
}
