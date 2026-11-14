// TEMPORARY dev page (client/station-dev.html): renders one station without the shell.
// ?s=engineering|helm|science|comms|sickbay|fleet|history|alerts  &as=captain|engineer|medical|science|comms|command
// &c=normal|yellow|red sets the condition attribute the shell will own.
import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../lib/auth.jsx';
import { SourcesProvider } from '../lib/context.jsx';
import { disconnect, state } from '../lib/store.js';
import { useTick } from '../lib/hooks.js';
import '../index.css';

const mods = import.meta.glob(['./*.jsx', '!./dev.jsx']);
const NAMES = ['helm', 'engineering', 'science', 'comms', 'sickbay', 'fleet', 'history', 'alerts'];
const load = (n) => mods[`./${n[0].toUpperCase()}${n.slice(1)}.jsx`];
const ACCOUNTS = { captain: 'ncc-captain', engineer: 'ncc-engineer', medical: 'ncc-medical', science: 'ncc-science', comms: 'ncc-comms', command: 'ncc-command' };
const q = new URLSearchParams(location.search);
const s = NAMES.includes(q.get('s')) ? q.get('s') : 'engineering';
document.documentElement.dataset.condition = q.get('c') || 'normal';
const Station = lazy(load(s === 'alerts' ? 'engineering' : s) ?? (async () => ({ default: () => <p style={{ color: '#fff' }}>Not built yet.</p> })));
const Drawer = s === 'alerts' && load('alerts') ? lazy(load('alerts')) : null;
const link = (patch) => `?${new URLSearchParams({ ...Object.fromEntries(q), ...patch })}`;

function Bar() {
  useTick(1000);
  const { user } = useAuth();
  return (
    <nav style={{ display: 'flex', gap: 12, alignItems: 'center', height: 36, padding: '0 12px', background: '#14161a', borderBottom: '2px solid #e0522a', font: '12px system-ui', color: '#8d95a0', overflowX: 'auto', whiteSpace: 'nowrap' }}>
      <b style={{ color: '#f1f3f5' }}>STATION DEV</b>
      {NAMES.map((n) => <a key={n} href={link({ s: n })} style={{ color: n === s ? '#5cb8ff' : '#b3b9c2' }}>{n}</a>)}
      <span style={{ marginLeft: 'auto' }}>{user?.username} · {state.status} · {state.rx ?? 0} readings/s</span>
    </nav>
  );
}

function Dev() {
  const { user, login } = useAuth();
  const [err, setErr] = useState(null);
  const as = q.get('as');
  useEffect(() => {
    if (as && ACCOUNTS[as] && user?.username !== as) login(as, ACCOUNTS[as]).catch((e) => setErr(e.message));
  }, [as]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user || (as && user.username !== as)) {
    return (
      <main style={{ padding: 24, color: '#f1f3f5', font: '14px system-ui' }}>
        <p>{err ?? 'Sign in as:'}</p>
        {Object.keys(ACCOUNTS).map((u) => <a key={u} href={link({ as: u })} style={{ marginRight: 12, color: '#5cb8ff' }}>{u}</a>)}
      </main>
    );
  }
  return (
    <SourcesProvider>
      {q.get('bare') !== '1' && <Bar />}
      <div id="station-host" style={{ height: q.get('bare') === '1' ? '100dvh' : 'calc(100dvh - 38px)', overflow: 'auto' }}>
        <Suspense fallback={null}>
          <Station shipId={Number(q.get('ship')) || 1} />
          {Drawer && <Drawer open onClose={() => {}} />}
        </Suspense>
      </div>
    </SourcesProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider onSignOut={disconnect}><Dev /></AuthProvider>
  </StrictMode>,
);
