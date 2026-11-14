import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { inField } from '../lib/keys.js';
import { ship } from '../lib/ship.js';
import { KeyCap, LitButton } from '../ui/index.js';

const KEY = 'ncc.toured';
const REPLAY = 'ncc:tour';
const STEPS = [
  { target: 'help', title: 'Help', text: 'Replay this tour, see every keyboard shortcut (?) or take the turbolift to any station (Ctrl K) from here.' },
  { target: 'viewscreen', title: 'Main viewer', text: 'The live view outside the ship. V cycles forward, tactical and exterior; + and − magnify.' },
  { target: 'tile-engineering', title: 'Stations on the wall', text: 'Each monitor shows one live reading from a station. Click one to go to its console. A lock means your role cannot enter it.' },
  { target: 'helm', title: 'Helm and navigation', text: 'Warp factor, heading and the weakest shield, straight from the ship’s telemetry.' },
  { target: 'chair', title: 'The captain’s chair', text: 'Condition and orders. The captain presses R for red alert, Y for yellow alert and N to stand down.' },
  { target: 'log', title: 'Captain’s log', text: 'The newest alerts, orders and scenario steps. All alerts opens the full list; A acknowledges the newest alert.' },
  { target: 'lift', title: 'Turbolift', text: 'The station tabs, or Ctrl K, take you to any station; G then a letter jumps straight there. Starfleet Command, the admin sign-in, also sees fleet server metrics and the scenario launcher.' },
];
const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
const modal = () => !!document.querySelector('[aria-modal="true"]');
// a modal panel is open (turbolift, scenario picker, shortcut sheet) or a scenario is running: the tour keeps out of the way
const busy = () => modal() || ['running', 'awaiting'].includes(ship.scenario?.state);
// the first element of a step that is on screen: the turbolift is the tab row on a desktop and the menu button on a phone
const targetOf = (name) => [...document.querySelectorAll(`[data-tour="${name}"]`)].find((el) => el.getClientRects().length) ?? null;

let replay = false;
/** Starts the tour over from its first step: at once while the bridge is open, else when it next opens (Help menu). */
export function replayTour() {
  replay = true;
  window.dispatchEvent(new Event(REPLAY));
}

/**
 * The tour of the bridge: a spotlight on each part with a short caption. On a first visit it waits for the visitor's
 * first click or key press on the bridge, never starts over a panel or a running scenario, and closes itself when one
 * opens; it is remembered in the browser. Help, Replay the tour starts it again from step 1, even during a scenario.
 */
export default function Tour() {
  const [step, setStep] = useState(-1);
  const [box, setBox] = useState(null);
  const asked = useRef(false); // replayed from Help: only a modal panel ends it early
  const done = () => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ } asked.current = false; setStep(-1); };
  const s = STEPS[step];

  useEffect(() => {
    const start = () => { if (!replay) return; replay = false; asked.current = true; setStep(0); };
    start();
    window.addEventListener(REPLAY, start);
    return () => window.removeEventListener(REPLAY, start);
  }, []);
  useEffect(() => {
    if (seen()) return undefined;
    let timer = 0;
    // checked a moment after the press, once whatever it opened is on screen
    const poke = () => { clearTimeout(timer); timer = setTimeout(() => { if (!busy()) { off(); setStep((n) => (n < 0 ? 0 : n)); } }, 400); };
    const off = () => { window.removeEventListener('pointerdown', poke, true); window.removeEventListener('keydown', poke, true); };
    window.addEventListener('pointerdown', poke, true);
    window.addEventListener('keydown', poke, true);
    return () => { off(); clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!s) return undefined;
    const id = setInterval(() => { if (asked.current ? modal() : busy()) done(); }, 300);
    return () => clearInterval(id);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!s) return undefined;
    const el = targetOf(s.target);
    if (!el) { setBox(null); return undefined; }
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const measure = () => { const r = el.getBoundingClientRect(); setBox({ x: r.left - 8, y: r.top - 8, w: r.width + 16, h: r.height + 16 }); };
    measure();
    const id = setInterval(measure, 300); // follows scrolling and the bridge's own scaling
    window.addEventListener('resize', measure);
    return () => { clearInterval(id); window.removeEventListener('resize', measure); };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!s) return undefined;
    const onKey = (e) => {
      if (inField(e.target) && !e.target.closest('.tour')) return; // keys typed into the turbolift or a form stay theirs
      if (e.key === 'Escape') done();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') setStep((n) => (n + 1 < STEPS.length ? n + 1 : (done(), -1)));
      else if (e.key === 'ArrowLeft') setStep((n) => Math.max(0, n - 1));
      else return;
      e.preventDefault();
      e.stopPropagation(); // the bridge's own shortcuts wait until the tour is over
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const cardW = Math.min(360, vw - 24);
  const below = box ? vh - (box.y + box.h) > 200 || box.y < 220 : true;
  const top = box ? (below ? Math.min(vh - 210, box.y + box.h + 12) : Math.max(12, box.y - 12 - 190)) : vh / 2 - 90;
  const left = box ? Math.min(vw - cardW - 12, Math.max(12, box.x + box.w / 2 - cardW / 2)) : vw / 2 - cardW / 2;
  return (
    <div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      {box && <div className="tour__spot" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      <div className="tour__card" style={{ left, top, width: cardW }} key={step}>
        <p className="tour__count mono">{step + 1} / {STEPS.length}</p>
        <h2 id="tour-title" className="tour__title">{s.title}</h2>
        <p className="tour__text">{s.text}</p>
        <div className="tour__actions">
          <button type="button" className="linkbtn" onClick={done}>Skip tour</button>
          {step > 0 && <LitButton color="white" size="sm" label="Back" onClick={() => setStep(step - 1)} />}
          <LitButton color="blue" size="sm" label={step + 1 < STEPS.length ? 'Next' : 'Take the conn'} keyCap="↵" lit onClick={() => (step + 1 < STEPS.length ? setStep(step + 1) : done())} />
        </div>
        <p className="label tour__keys"><KeyCap>←</KeyCap> <KeyCap>→</KeyCap> to step, <KeyCap>Esc</KeyCap> to close</p>
      </div>
    </div>
  );
}
