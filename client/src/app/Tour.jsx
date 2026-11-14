import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../lib/auth.jsx';
import { inField } from '../lib/keys.js';
import { ship } from '../lib/ship.js';
import { KeyCap, LitButton } from '../ui/index.js';
import { TOURS } from './tours.js';

// a modal panel is open (turbolift, scenario picker, shortcut sheet) or a scenario is running: the tour keeps out of the way
const busy = () => !!document.querySelector('[aria-modal="true"]') || ['running', 'awaiting'].includes(ship.scenario?.state);

// a step's spotlight: a monitor by its title, the console along the bottom, or a data-tour mark
const elOf = (s) => [...document.querySelectorAll(s.desk ? '.console-strip' : s.mon ? `section.monitor[aria-label="${s.mon}"]` : `[data-tour="${s.target}"]`)].find((el) => el.getClientRects().length)
  ?? (s.target === 'lift' ? document.querySelector('.tabs-menu') : null); // on a phone the tabs are the menu button

/**
 * The first-visit guide of a page (`page`: bridge, a station id, history or alerts; steps in tours.js), worded for the
 * signed-in role: a spotlight on each part with a short caption. It starts on its own `delay` ms after the page opens,
 * never over a panel or a running scenario (then it waits for the next click or key), and closes itself when one
 * opens. Remembered in the browser per user and page, so every role meets every page's guide once.
 */
export default function Tour({ page, delay = 600 }) {
  const { user } = useAuth();
  const steps = useMemo(() => (TOURS[page] ?? []).filter((x) => !x.when || x.when(user)), [page, user]);
  const key = `ncc.toured.${user?.username}.${page}`;
  const seen = () => { try { return !steps.length || localStorage.getItem(key) === '1'; } catch { return true; } };
  const [step, setStep] = useState(-1);
  const [box, setBox] = useState(null);
  const done = () => { try { localStorage.setItem(key, '1'); } catch { /* private mode */ } setStep(-1); };
  const s = steps[step];
  const text = s && (typeof s.text === 'function' ? s.text(user) : s.text);

  useEffect(() => {
    if (seen()) return undefined;
    let timer = 0;
    const begin = () => { if (!busy()) { off(); setStep(0); } };
    // over a panel or a scenario: a later press tries again, once whatever it opened is on screen
    const poke = () => { clearTimeout(timer); timer = setTimeout(begin, 400); };
    const off = () => { window.removeEventListener('pointerdown', poke, true); window.removeEventListener('keydown', poke, true); };
    window.addEventListener('pointerdown', poke, true);
    window.addEventListener('keydown', poke, true);
    timer = setTimeout(begin, delay); // no waiting for a click: the guide starts as the page opens
    return () => { off(); clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!s) return undefined;
    const id = setInterval(() => { if (busy()) done(); }, 300);
    return () => clearInterval(id);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!s) return undefined;
    const el = elOf(s);
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
      else if (e.key === 'ArrowRight' || e.key === 'Enter') setStep((n) => (n + 1 < steps.length ? n + 1 : (done(), -1)));
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
  // portalled to the body: a station view's own transform would otherwise shift the fixed spotlight
  return createPortal(
    <div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      {box && <div className="tour__spot" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      <div className="tour__card" style={{ left, top, width: cardW }} key={step}>
        <p className="tour__count mono">{step + 1} / {steps.length}</p>
        <h2 id="tour-title" className="tour__title">{s.title}</h2>
        <p className="tour__text">{text}</p>
        <div className="tour__actions">
          <button type="button" className="linkbtn" onClick={done}>Skip tour</button>
          {step > 0 && <LitButton color="white" size="sm" label="Back" onClick={() => setStep(step - 1)} />}
          <LitButton color="blue" size="sm" label={step + 1 < steps.length ? 'Next' : page === 'bridge' ? 'Take the conn' : 'Got it'} keyCap="↵" lit onClick={() => (step + 1 < steps.length ? setStep(step + 1) : done())} />
        </div>
        <p className="label tour__keys"><KeyCap>←</KeyCap> <KeyCap>→</KeyCap> to step, <KeyCap>Esc</KeyCap> to close</p>
      </div>
    </div>,
    document.body,
  );
}
