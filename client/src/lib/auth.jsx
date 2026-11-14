import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { SESSION_KEY, api, loadSession, saveSession, setTabToken, setUnauthorizedHandler } from './api.js';

const Auth = createContext(null);
export const useAuth = () => useContext(Auth);

const claims = (token) => {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
};
// When a session runs out on this browser's clock: the token's lifetime (exp - iat, both set by the server)
// counted from when this browser received it, so a wrong system clock cannot end a session early.
const expiresAt = (s) => {
  const c = s?.token && claims(s.token);
  if (!c?.exp) return null;
  return s.receivedAt && c.iat ? s.receivedAt + (c.exp - c.iat) * 1000 : c.exp * 1000;
};
// sign out shortly before the server stops accepting the token
const EARLY_MS = 30000;
const NOTICES = {
  expired: 'Your sign-in expired: sessions last 12 hours. Sign in again to carry on.',
  refused: 'The server no longer accepts this sign-in, so you were signed out. Sign in again to carry on.',
  elsewhere: 'You signed out in another tab, so this one was signed out too.',
};

// read once per page load: a stored session that has run out is dropped before anything uses it
const START = (() => {
  const s = loadSession();
  if (s && (expiresAt(s) ?? Infinity) - EARLY_MS <= Date.now()) { saveSession(null); return { session: null, notice: NOTICES.expired }; }
  return { session: s, notice: null };
})();

setTabToken(START.session?.token); // a reload restores the saved sign-in

/** `onSignOut` runs before the session is dropped (close sockets, clear caches). Pass a stable function. */
export function AuthProvider({ children, onSignOut }) {
  const [current, setSession] = useState(START.session);
  const [notice, setNotice] = useState(START.notice); // why the user was signed out, shown on the login page
  const mine = useRef(START.session); // this tab's session: other tabs share the stored one
  const logout = useCallback((why) => {
    const s = mine.current;
    onSignOut?.();
    // keep the first reason when several arrive together, such as the expiry timer and a refused request
    if (why) setNotice((n) => n || NOTICES[why === 'refused' && (expiresAt(s) ?? Infinity) <= Date.now() ? 'expired' : why]);
    // another tab may have signed in since: only remove the stored session if it is this tab's
    if (s && loadSession()?.token === s.token) saveSession(null);
    mine.current = null;
    setTabToken(null);
    setSession(null);
  }, [onSignOut]);
  useEffect(() => { setUnauthorizedHandler(() => logout('refused')); }, [logout]);
  // signing out in one tab signs the others out too
  useEffect(() => {
    const onStorage = (e) => { if (e.key === SESSION_KEY && !e.newValue && mine.current) logout('elsewhere'); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [logout]);
  // sign out when the session runs out, instead of leaving a page that can no longer reconnect
  useEffect(() => {
    const at = expiresAt(current);
    if (!at) return undefined;
    const ms = at - EARLY_MS - Date.now();
    if (ms <= 0) { logout('expired'); return undefined; }
    const id = setTimeout(() => logout('expired'), Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [current, logout]);
  const login = async (username, password) => {
    const s = { ...(await api('/api/auth/login', { method: 'POST', body: { username, password } })), receivedAt: Date.now() };
    saveSession(s);
    mine.current = s;
    setTabToken(s.token);
    setNotice(null);
    setSession(s);
  };
  const v = useMemo(() => ({ user: current?.user, login, logout: () => logout(), notice }), [current, logout, notice]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Auth.Provider value={v}>{children}</Auth.Provider>;
}
