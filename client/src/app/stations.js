// The bridge's stations: route, label, division, the G-key that goes there, and who may enter.
// Station screens live in client/src/stations/<Name>.jsx (default export), found at build time and loaded on first visit.
const screens = import.meta.glob('../stations/*.jsx');
export const screenOf = (name) => screens[`../stations/${name}.jsx`] ?? null;

// `needs`: the registry group a role must hold to use the station (DOMAIN.md section 6); `admin`: Starfleet only.
export const STATIONS = [
  { id: 'bridge', path: '/bridge', label: 'Bridge', short: 'Bridge', division: 'command', key: 'b' },
  { id: 'helm', path: '/helm', label: 'Helm', short: 'Helm', division: 'command', key: 'h', screen: 'Helm', needs: 'helm', who: 'Captain, science and communications officers' },
  { id: 'engineering', path: '/engineering', label: 'Engineering', short: 'Eng', division: 'ops', key: 'e', screen: 'Engineering', needs: 'warp', who: 'Captain and chief engineer' },
  { id: 'science', path: '/science', label: 'Science', short: 'Sci', division: 'science', key: 's', screen: 'Science', needs: 'sensors', who: 'Captain, science and communications officers' },
  { id: 'comms', path: '/comms', label: 'Comms', short: 'Comms', division: 'ops', key: 'c', screen: 'Comms', needs: 'comms', who: 'Captain, science and communications officers' },
  { id: 'sickbay', path: '/sickbay', label: 'Sickbay', short: 'Med', division: 'science', key: 'm', screen: 'Sickbay', needs: 'bio-d01', who: 'Medical records: CMO and captain only' },
  { id: 'fleet', path: '/fleet', label: 'Starfleet', short: 'Fleet', division: 'fleet', key: 'f', screen: 'Fleet', admin: true, who: 'Starfleet Command only' },
];
// Pages the stations build adds next to the stations; anyone signed in may open them.
export const PAGES = [
  { id: 'history', path: '/history', label: 'History', short: 'Hist', division: 'fleet', screen: 'History' },
  { id: 'alerts', path: '/alerts', label: 'Alerts', short: 'Alerts', division: 'fleet', screen: 'Alerts' },
];

export const stationById = Object.fromEntries([...STATIONS, ...PAGES].map((s) => [s.id, s]));
export const stationAt = (pathname) => [...STATIONS, ...PAGES].find((s) => pathname === s.path || pathname.startsWith(`${s.path}/`)) ?? null;

/** True when the user's role may use the station; the server refuses the data anyway. */
export function canEnter(user, st) {
  if (!user || !st) return false;
  if (st.admin) return !!user.admin;
  return !st.needs || (user.groups ?? []).includes(st.needs);
}
