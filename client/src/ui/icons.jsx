import { useId } from 'react';

// Authored SVG icons, one 1.6 px stroke on a 20 px box, plus the Starfleet delta drawn per division (DESIGN.md, Assets).

const PATHS = {
  lock: <><rect x="4.5" y="9" width="11" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></>,
  soundOn: <><path d="M3.5 8h3l4-3.5v11l-4-3.5h-3z" /><path d="M13.5 7.2a4 4 0 0 1 0 5.6M15.8 5a7 7 0 0 1 0 10" /></>,
  soundOff: <><path d="M3.5 8h3l4-3.5v11l-4-3.5h-3z" /><path d="M13.5 8l4 4M17.5 8l-4 4" /></>,
  menu: <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  keyboard: <><rect x="2.5" y="5.5" width="15" height="9" rx="1.5" /><path d="M5.5 8.5h1M8.5 8.5h1M11.5 8.5h1M14 8.5h.5M6.5 11.5h7" /></>,
  signOut: <><path d="M8 4.5H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" /><path d="M11.5 6.5L15 10l-3.5 3.5M15 10H8" /></>,
  up: <path d="M5 12.5l5-5 5 5" />,
  down: <path d="M5 7.5l5 5 5-5" />,
  back: <path d="M12.5 5l-5 5 5 5" />,
  lift: <><rect x="4.5" y="2.5" width="11" height="15" rx="1.5" /><path d="M10 2.5v15M7.5 8l-1 1.5h2zM12.5 12l1-1.5h-2z" /></>,
};

export function Icon({ name, title, className = 'icon', ...rest }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} {...rest}>
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}

// The original-series delta: a pointed arrowhead with a curved, notched base. The emblem inside says the division.
const DELTA = 'M12 1.2C14.6 7.6 18.2 16.4 21.2 26.6 18.3 23.6 15.2 22.2 12 22.2 8.8 22.2 5.7 23.6 2.8 26.6 5.8 16.4 9.4 7.6 12 1.2Z';
const EMBLEM = {
  // command: four-pointed star
  command: <path d="M12 9.2l1.15 3.65 3.65 1.15-3.65 1.15L12 18.8l-1.15-3.65L7.2 14l3.65-1.15z" />,
  // sciences: a ring around a dot
  science: <><circle cx="12" cy="14.6" r="3.4" fill="none" strokeWidth="1.5" /><circle cx="12" cy="14.6" r="1.1" /></>,
  // medical: the sciences ring with a cross
  medical: <><circle cx="12" cy="14.6" r="3.6" fill="none" strokeWidth="1.3" /><path d="M11.2 12h1.6v1.8h1.8v1.6h-1.8v1.8h-1.6v-1.8H9.4v-1.6h1.8z" /></>,
  // operations: a spiral
  ops: <path d="M12 14.6m-0.6 0a0.6 0.6 0 1 1 1.2 0a1.8 1.8 0 1 1-3.6 0a3 3 0 1 1 6 0" fill="none" strokeWidth="1.4" strokeLinecap="round" />,
  fleet: null,
};

export const ROLE_EMBLEM = {
  captain: 'command',
  chief_engineer: 'ops',
  communications_officer: 'ops',
  science_officer: 'science',
  chief_medical_officer: 'medical',
  starfleet_command: 'fleet',
};

/** emblem: command | science | medical | ops | fleet. Gold metal delta, emblem cut in black, as on the uniforms. */
export function Delta({ emblem = 'command', className = 'delta', title }) {
  const id = useId(); // one gradient per drawing: a shared id breaks when its first copy is hidden
  return (
    <svg viewBox="0 0 24 28" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbe7a6" />
          <stop offset="0.45" stopColor="#e3b44a" />
          <stop offset="1" stopColor="#9b6f1d" />
        </linearGradient>
      </defs>
      <path d={DELTA} fill={`url(#${id})`} stroke="#5c3f0c" strokeWidth="0.6" />
      <g fill="#14110a" stroke="#14110a">{EMBLEM[emblem]}</g>
    </svg>
  );
}
