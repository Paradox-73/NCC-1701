import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Shell from './app/Shell.jsx';
import Stage from './app/Stage.jsx';
import { homeOf } from './app/stations.js';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { SourcesProvider } from './lib/context.jsx';
import { resetShip } from './lib/ship.js';
import { disconnect, setAuthLostHandler } from './lib/store.js';

// the socket closes and its data is forgotten whenever the user signs out, so the next user starts clean
const onSignOut = () => { disconnect(); resetShip(); };

// The way aboard, in order:
//   coldopen  the Engage gate, then the ship glides in while the narration types; Skip goes to identify. Every
//             visit and every sign-out starts here
//   identify  "State your position": the ship in the left half, turning slowly, to drag round and zoom; the login
//             console in the right half. Below 1024 px wide the ship sits above the console
//   boarding  signed in: the camera zooms into the ship and through the bridge dome
//   fade      the scene cross-fades into the bridge, which powers up underneath
//   aboard    the bridge alone
function Root() {
  const { user, logout } = useAuth();
  useEffect(() => { setAuthLostHandler(() => logout('refused')); }, [logout]);
  const [phase, setPhase] = useState(() => (user ? 'aboard' : 'coldopen'));
  useEffect(() => { if (!user) setPhase('coldopen'); }, [user]); // signed out: back to the Engage gate
  // A sign-in always starts at that role's own seat (captain: bridge, chief engineer: engineering, ...), whatever page
  // the last person was on before signing out. A reload while signed in keeps its page, and moving between stations
  // afterwards is untouched.
  const navigate = useNavigate();
  const signedIn = useRef(!!user);
  // Signed out (or arriving at a station link without a session): the address goes back to the start page, replacing
  // the station in history, so Back never shows a page the next person has not signed in for.
  const { pathname } = useLocation();
  useEffect(() => {
    if (user && !signedIn.current) navigate(homeOf(user), { replace: true });
    else if (!user && pathname !== '/') navigate('/', { replace: true });
    signedIn.current = !!user;
  }, [user, pathname, navigate]);
  const toIdentify = useCallback(() => setPhase('identify'), []);
  const toFade = useCallback(() => setPhase('fade'), []);
  const toAboard = useCallback(() => setPhase('aboard'), []);
  // a sign-in moves the stage on to boarding in the same render, so its canvas never unmounts in between
  const stagePhase = user && (phase === 'identify' || phase === 'coldopen') ? 'boarding' : phase;
  return (
    <>
      {user && (
        <SourcesProvider>
          <Shell powered={phase === 'fade' || phase === 'aboard'} aboard={phase === 'aboard'} />
        </SourcesProvider>
      )}
      {stagePhase !== 'aboard' && <Stage phase={stagePhase} onOpened={toIdentify} onBoarded={toFade} onFaded={toAboard} />}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider onSignOut={onSignOut}>
      <Root />
    </AuthProvider>
  );
}
