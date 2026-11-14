import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { ButtonGrid, Delta, Jewel, LitButton } from '../ui/index.js';
import './login.css';

// One demo account per role, as seeded by server/src/seed.js. A lit button per account, coloured by division.
const POSITIONS = [
  { username: 'captain', password: 'ncc-captain', label: 'Captain', emblem: 'command', color: 'yellow', post: 'Command · the chair' },
  { username: 'engineer', password: 'ncc-engineer', label: 'Chief Engineer', emblem: 'ops', color: 'red', post: 'Operations · engineering' },
  { username: 'medical', password: 'ncc-medical', label: 'Chief Medical Officer', emblem: 'medical', color: 'blue', post: 'Sciences · sickbay' },
  { username: 'science', password: 'ncc-science', label: 'Science Officer', emblem: 'science', color: 'blue', post: 'Sciences · library computer' },
  { username: 'comms', password: 'ncc-comms', label: 'Communications Officer', emblem: 'ops', color: 'red', post: 'Operations · subspace radio' },
  { username: 'command', password: 'ncc-command', label: 'Starfleet Command', emblem: 'fleet', color: 'white', post: 'Task force · all four ships' },
];

/** "State your position": the login console beside the ship. leaving: signed in, the console powers down. */
export default function Login({ leaving }) {
  const { login, notice } = useAuth();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const signIn = async (u, p) => {
    setBusy(u);
    setError(null);
    // 429: the server's login limit (10 failed sign-ins a minute per address) blocks every sign-in until the minute is up
    try { await login(u, p); } catch (e) { setError(e.status === 429 ? 'Too many wrong sign-ins from this network. Try again in 60 s.' : e.message); setBusy(null); }
  };
  return (
    <section className="identify" data-leaving={leaving || undefined} aria-labelledby="identify-title" inert={leaving || undefined}>
      <header className="identify__head">
        <Delta emblem="command" className="delta identify__delta" />
        <div>
          <p className="identify__ship">U.S.S. Enterprise · NCC-1701</p>
          <h1 id="identify-title" className="identify__title">State your position</h1>
        </div>
        <Jewel status={busy ? 'warn' : 'info'} label={busy ? 'Checking clearance' : 'Console ready'} size="lg" />
      </header>
      {notice && <p className="identify__notice" role="status">{notice}</p>}
      <div className="positions" role="group" aria-label="Demo crew positions">
        {POSITIONS.map((p, i) => (
          <LitButton key={p.username} color={p.color} className="position" style={{ '--i': i }} pending={busy === p.username} lit={busy === p.username}
            disabled={!!busy && busy !== p.username} onClick={() => signIn(p.username, p.password)}>
            <Delta emblem={p.emblem} className="delta position__delta" />
            <span className="position__text">
              <span className="position__label">{p.label}</span>
              <span className="position__post">{p.post}</span>
            </span>
          </LitButton>
        ))}
      </div>
      <form className="identify__form" onSubmit={(e) => { e.preventDefault(); signIn(username, password); }}>
        <p className="label">Or sign in with your own account</p>
        <div className="identify__fields">
          <label><span className="sr-only">Username</span><input className="field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="Username" required /></label>
          <label><span className="sr-only">Password</span><input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="Password" required /></label>
          <LitButton type="submit" color="green" label="Sign in" pending={busy === username && !!username} disabled={!!busy} onClick={() => {}} />
        </div>
        {error && <p className="identify__error" role="alert">{error === 'wrong username or password' ? 'Clearance refused: wrong username or password.' : error}</p>}
      </form>
      <ButtonGrid rows={2} cols={22} seed={17} className="identify__grid" />
    </section>
  );
}
