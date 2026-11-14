import { AuthProvider, useAuth } from './lib/auth.jsx';
import Login from './pages/Login.jsx';

function Routes() {
  const { user, logout } = useAuth();
  if (!user) return <Login />;
  return <main><p>Signed in as {user.username} ({user.label}). <button onClick={logout}>Sign out</button></p></main>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  );
}
