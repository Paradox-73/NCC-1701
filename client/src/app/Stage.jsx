import { useCallback, useEffect, useRef, useState } from 'react';
import { reducedMotion } from '../lib/chartTheme.js';
import { stardate } from '../lib/ship.js';
import { duckMusic, play, soundOn, toggleSound, useSound } from '../lib/sound.js';
import Login from '../pages/Login.jsx';
import StarshipView, { hasWebGL } from '../three/StarshipView.jsx';
import { FLIGHT_MS, NARRATION_AT, THEME_AT } from '../three/rig.js';
import { Delta, Icon, KeyCap, LitButton } from '../ui/index.js';
import './stage.css';

const FADE_MS = 800;
const NO_SHIELDS = { fore: 0, aft: 0, port: 0, starboard: 0 }; // no bubble around the hero shot

// Our own narration after the one famous opener (the show's monologue is heard, not quoted).
const LINES = [
  'Space: the final frontier.',
  'Aboard the starship Enterprise, every system reports to the bridge.',
  'Every deck. Every reading. Every heartbeat. Live.',
  () => `Captain's log, stardate ${stardate().toFixed(1)}. The bridge is waiting.`,
];
const TYPE_MS = 34; // per character

/** Types `text` in a character at a time once `on`; reduced motion shows it whole. */
function Typed({ text, on }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    if (reducedMotion()) { setN(text.length); return undefined; }
    const id = setInterval(() => setN((k) => (k >= text.length ? (clearInterval(id), k) : k + 1)), TYPE_MS);
    return () => clearInterval(id);
  }, [text, on]);
  if (!on) return null;
  return (
    <p className="narration__line" data-done={n >= text.length || undefined}>
      <span aria-hidden="true">{text.slice(0, n)}</span>
      <span className="sr-only">{text}</span>
    </p>
  );
}

// The original-series opening (client/public/audio/intro.mp3): narration, then the theme. It follows the global
// sound switch live, and fades out when the user skips or picks a position. The background music ducks out while
// it plays and comes back when it stops.
function useIntro() {
  const audio = useRef(null);
  const sound = useSound();
  useEffect(() => { if (audio.current) audio.current.muted = !sound; }, [sound]);
  useEffect(() => () => audio.current?.pause(), []);
  const start = () => {
    const a = new Audio(`${import.meta.env.BASE_URL}audio/intro.mp3`);
    a.muted = !soundOn();
    audio.current = a;
    duckMusic('intro', 0);
    const back = () => duckMusic('intro', 1, 1.5);
    a.addEventListener('pause', back);
    a.addEventListener('ended', back);
    return a.play().then(() => a, () => { back(); return null; }); // a refused play leaves the cold open running on its own clock
  };
  const fadeOut = useCallback((ms = 1200) => {
    const a = audio.current;
    if (!a || a.paused) return;
    const v0 = a.volume;
    const t0 = performance.now();
    const id = setInterval(() => {
      const k = (performance.now() - t0) / ms;
      if (k >= 1) { clearInterval(id); a.pause(); } else a.volume = v0 * (1 - k);
    }, 40);
  }, []);
  return { audio, start, fadeOut };
}

/** Engage: the click that unlocks sound. Then the narration types in step with the audio, and the login comes on the beat drop. */
function ColdOpen({ intro, onStart, onDone }) {
  const [shown, setShown] = useState(null); // narration lines on screen; null before Engage
  const lines = useRef(LINES.map((l) => (typeof l === 'function' ? l() : l))).current;
  const skip = useCallback(() => { intro.fadeOut(900); onDone(); }, [intro, onDone]);

  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []); // set again on remount (StrictMode runs effects twice)
  const engage = async () => {
    setShown(0);
    const a = await intro.start();
    if (!alive.current) return undefined; // skipped while the audio was starting
    onStart();
    const t0 = performance.now();
    // The audio's own clock times the lines and the drop; the wall clock takes over with no audio, or one stalled
    // over a second. Read every frame, so the login lands within a frame of the drop.
    const clock = () => Math.max(a ? a.currentTime * 1000 : 0, performance.now() - t0 - (a ? 1000 : 0));
    let id = requestAnimationFrame(function tick() {
      const ms = clock();
      if (ms >= THEME_AT) { onDone(); return; }
      setShown(NARRATION_AT.filter((at) => ms >= at).length);
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  };
  const stop = useRef(null);
  useEffect(() => () => stop.current?.(), []);
  useEffect(() => {
    if (shown == null) return undefined;
    const onKey = (e) => { if (!e.repeat && !['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'm', 'M'].includes(e.key)) skip(); }; // a held Enter from the gate is not a skip
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown == null, skip]); // eslint-disable-line react-hooks/exhaustive-deps

  const onEngage = async () => { stop.current = await engage(); };
  if (shown == null) {
    return (
      <div className="gate">
        <div className="gate__panel">
          <Delta emblem="command" className="delta gate__delta" />
          <p className="gate__ship">U.S.S. Enterprise · NCC-1701</p>
          <h1 className="gate__title">Bridge</h1>
          <LitButton color="amber" size="lg" className="gate__engage" label="Engage" aria-keyshortcuts="Enter" autoFocus onClick={onEngage} />
          <KeyCap>Enter</KeyCap>
          <div className="gate__more">
            <SoundToggle />
            <button type="button" className="stage-pill" onClick={skip}>Skip intro <KeyCap>Esc</KeyCap></button>
          </div>
        </div>
        <GateKeys onEngage={onEngage} onSkip={skip} />
      </div>
    );
  }
  return (
    <div className="coldopen" onPointerDown={skip}>
      <div className="narration" aria-live="polite">
        {lines.map((l, i) => <Typed key={i} text={l} on={i < shown} />)}
      </div>
      <div className="stage__bar" onPointerDown={(e) => e.stopPropagation()}>
        <SoundToggle />
        <button type="button" className="stage-pill" onClick={skip}>Skip <KeyCap>any key</KeyCap></button>
      </div>
    </div>
  );
}

/** The speaker switch, with its state in words: sound is on unless the user mutes it. */
function SoundToggle() {
  const sound = useSound();
  return (
    <button type="button" className="stage-pill stage-pill--sound" onClick={toggleSound} aria-pressed={sound} aria-keyshortcuts="M" title="Sound on or off (M)">
      <Icon name={sound ? 'soundOn' : 'soundOff'} />{sound ? 'Sound on' : 'Sound off'}
    </button>
  );
}

// Enter engages from anywhere on the gate (a focused button keeps its own Enter); Esc skips to the login.
function GateKeys({ onEngage, onSkip }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onSkip();
      else if (e.key === 'Enter' && !e.repeat && !e.target.closest?.('button, a, input')) onEngage();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEngage, onSkip]);
  return null;
}

/**
 * The full-screen scene outside the ship, from the cold open to the cross-fade into the bridge.
 * phase: coldopen | identify | boarding | fade (see App.jsx).
 */
export default function Stage({ phase, onOpened, onBoarded, onFaded }) {
  const [flying, setFlying] = useState(false);
  const [gliding, setGliding] = useState(false);
  const skip = useRef(() => {});
  const stage = useRef(null);
  const intro = useIntro();
  useEffect(() => {
    const onM = (e) => { if ((e.key === 'm' || e.key === 'M') && (phase === 'coldopen' || phase === 'identify') && !e.target.closest?.('input')) toggleSound(); };
    window.addEventListener('keydown', onM);
    return () => window.removeEventListener('keydown', onM);
  }, [phase]);

  // boarding: the music fades, the camera zooms into the ship and through the dome, then the cross-fade
  useEffect(() => {
    if (phase !== 'boarding') return undefined;
    intro.fadeOut(1200);
    if (reducedMotion() || !hasWebGL()) { onBoarded(); return undefined; }
    stage.current.scrollTo({ top: 0, behavior: 'smooth' }); // a phone scrolled down to the console: the ship back in view
    setFlying(true);
    play('lift');
    const t = setTimeout(onBoarded, FLIGHT_MS);
    skip.current = () => { clearTimeout(t); onBoarded(); };
    const onKey = (e) => { if (e.key === 'Escape') skip.current(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [phase, onBoarded, intro.fadeOut]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'fade') return undefined;
    play('station');
    const t = setTimeout(onFaded, reducedMotion() ? 150 : FADE_MS);
    return () => clearTimeout(t);
  }, [phase, onFaded]);

  const rig = phase === 'coldopen' ? (gliding ? 'flyby' : 'wait') : flying || phase === 'fade' ? 'board' : 'login';
  return (
    <div ref={stage} className="stage" data-phase={phase} data-gliding={gliding || undefined} onClick={phase === 'boarding' ? () => skip.current() : undefined}>
      <div className="stage__ship" aria-hidden="true">
        <StarshipView rig={rig} visible={rig !== 'wait'} spin={phase === 'identify'} warp={2} alert="green" shields={NO_SHIELDS} />
      </div>
      <div className="stage__veil" aria-hidden="true" />
      {phase === 'coldopen' && <ColdOpen intro={intro} onStart={() => setGliding(true)} onDone={onOpened} />}
      {(phase === 'identify' || phase === 'boarding') && <Login leaving={phase === 'boarding'} />}
      {phase === 'identify' && <div className="stage__bar"><SoundToggle /></div>}
      {(phase === 'boarding' || phase === 'fade') && flying && <div className="stage__flash" aria-hidden="true" />}
    </div>
  );
}
