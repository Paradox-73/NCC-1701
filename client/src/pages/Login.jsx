import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { login, notice } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try { await login(username, password); } catch (err) { setError(err.message); }
  };
  return (
    <main>
      <h1>NCC-1701 Bridge</h1>
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={submit}>
        <p><label>Username <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label></p>
        <p><label>Password <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label></p>
        <button type="submit">Sign in</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
