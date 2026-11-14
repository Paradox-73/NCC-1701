// Thin fetch wrapper: base URL from VITE_API_URL, bearer token from localStorage.
export const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
export const SESSION_KEY = 'ncc.session';
const KEY = SESSION_KEY;

export function loadSession() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
export function saveSession(s) {
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

// `token` overrides the stored sign-in (a caller may pass its own)
// this tab's own sign-in: the stored session is shared with every other tab of the browser
let tabToken = null;
export const setTabToken = (t) => { tabToken = t || null; };
export const getTabToken = () => tabToken;

export async function api(path, { method = 'GET', body, query, signal, token = tabToken } = {}) {
  const url = new URL(path, API);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, {
      method, signal,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error(`Cannot reach the server at ${API}`);
  }
  if (res.status === 401 && path !== '/api/auth/login') onUnauthorized();
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
  return data;
}
