import { useEffect } from 'react';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { SourcesProvider } from './lib/context.jsx';
import { disconnect, setAuthLostHandler } from './lib/store.js';
import Login from './pages/Login.jsx';

// the socket closes and its data is forgotten whenever the user signs out, so the next user starts clean
const onSignOut = () => disconnect();

function Routes() {
  const { user, logout } = useAuth();
  useEffect(() => { setAuthLostHandler(() => logout('refused')); }, [logout]);
  if (!user) return <Login />;
  return <SourcesProvider><main><p>Signed in as {user.username} ({user.label}). <button onClick={() => logout()}>Sign out</button></p></main></SourcesProvider>;
}

export default function App() {
  return (
    <AuthProvider onSignOut={onSignOut}>
      <Routes />
    </AuthProvider>
  );
}
