import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getTabToken } from './api.js';
import { useAuth } from './auth.jsx';
import { connect, onConnection, seedAlerts } from './store.js';

const Sources = createContext(null);
export const useSources = () => useContext(Sources);

// Loads the sources this user may see, opens the one socket and seeds alert history.
// Runs again after a reconnect, quietly, so sources and alerts missed while offline appear.
export function SourcesProvider({ children }) {
  const { user } = useAuth();
  const [st, setSt] = useState({ sources: [], loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  const failed = useRef(false); // the last load failed: the first connection after a cold start must reload too
  useEffect(() => onConnection((s, info) => { if (s === 'online' && (info?.reconnect || failed.current)) setAttempt((n) => n + 1); }), []);
  useEffect(() => {
    const token = getTabToken();
    if (!token) return undefined;
    let dead = false;
    setSt((s) => ({ ...s, loading: !s.sources.length, error: null }));
    connect(token);
    (async () => {
      try {
        const { sources } = await api('/api/sources');
        if (dead) return;
        failed.current = false;
        setSt({ sources, loading: false, error: null });
        api('/api/alerts').then((a) => seedAlerts(a.alerts || [])).catch(() => {});
      } catch (e) {
        failed.current = true;
        if (!dead) setSt((s) => (s.sources.length ? { ...s, loading: false } : { sources: [], loading: false, error: e.message }));
      }
    })();
    return () => { dead = true; };
  }, [user?.username, attempt]);
  const v = useMemo(() => ({ ...st, byId: Object.fromEntries(st.sources.map((s) => [s.sourceId, s])), retry: () => setAttempt((n) => n + 1) }), [st]);
  return <Sources.Provider value={v}>{children}</Sources.Provider>;
}
