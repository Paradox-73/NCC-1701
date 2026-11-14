// Bridge sound (DESIGN.md, Sound). Muted by default; the first unmute is the user gesture browsers need, and it
// creates the one AudioContext and loads every clip. A clip is /sfx/<cue>.mp3 when the sound kit ships it, else a
// few lines of oscillator code stand in. Master gain -12 dB, at most 4 voices, a cooldown per cue.
import { useSyncExternalStore } from 'react';

const KEY = 'ncc.sound';
const CUES = ['press', 'ack', 'hail', 'intercom', 'yellow', 'red', 'station', 'lift', 'warp', 'chirp', 'phaser', 'torpedo'];
const COOLDOWN = { press: 60, ack: 150, red: 4500, yellow: 2500, station: 300, lift: 1000 };

let enabled = false;
try { enabled = localStorage.getItem(KEY) === '1'; } catch { /* private mode */ }
let ctx = null;
let master = null;
let voices = 0;
const buffers = new Map();
const lastAt = new Map();
const listeners = new Set();

function ensureContext() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.25; // -12 dB
  master.connect(ctx.destination);
  for (const cue of CUES) {
    fetch(`${import.meta.env.BASE_URL}sfx/${cue}.mp3`)
      .then((r) => (r.ok && /audio/.test(r.headers.get('content-type') || '') ? r.arrayBuffer() : null))
      .then((b) => b && ctx.decodeAudioData(b))
      .then((buf) => buf && buffers.set(cue, buf))
      .catch(() => { /* the synth stands in */ });
  }
}

export const soundOn = () => enabled;
export function setSound(on) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode */ }
  if (on) ensureContext();
  listeners.forEach((fn) => fn());
}
export const toggleSound = () => setSound(!enabled);
export const useSound = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, soundOn);

// ---- synth stand-ins ---------------------------------------------------------
function tone(type, f0, f1, dur, gain = 0.5, at = 0) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
  return dur + at;
}
function noise(dur, f0, f1, gain = 0.4) {
  const t = ctx.currentTime;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 0.8;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  return dur;
}
const SYNTH = {
  press: () => tone('sine', 1200, 1200, 0.05, 0.25),
  ack: () => Math.max(tone('sine', 1600, 1600, 0.07, 0.25), tone('sine', 1200, 1200, 0.08, 0.25, 0.08)),
  chirp: () => Math.max(tone('square', 2200, 2200, 0.05, 0.12), tone('square', 2900, 2900, 0.05, 0.12, 0.07)),
  hail: () => tone('sine', 800, 1600, 0.3, 0.3),
  intercom: () => Math.max(tone('sine', 1400, 1400, 0.12, 0.3), tone('sine', 1800, 1800, 0.18, 0.3, 0.13)),
  yellow: () => Math.max(tone('square', 660, 660, 0.35, 0.18), tone('square', 880, 880, 0.35, 0.18, 0.38)),
  red: () => {
    // the original-series whoop: a sawtooth sweep up through a low-pass, twice
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    lp.connect(master);
    for (let i = 0; i < 2; i++) {
      const s = t + i * 0.95;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(440, s);
      o.frequency.exponentialRampToValueAtTime(880, s + 0.7);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.32, s + 0.05);
      g.gain.setValueAtTime(0.32, s + 0.62);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.8);
      o.connect(g).connect(lp);
      o.start(s);
      o.stop(s + 0.82);
    }
    return 1.8;
  },
  station: () => noise(0.5, 400, 3000, 0.35),
  lift: () => noise(1.4, 200, 2400, 0.3),
  warp: () => noise(1.1, 150, 5000, 0.35),
  phaser: () => noise(0.6, 4000, 600, 0.4),
  torpedo: () => tone('sine', 220, 60, 0.6, 0.5),
};

/** Plays a cue when sound is on. `times` repeats it back to back (red alert plays twice, then silence). */
export function play(cue, times = 1) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const now = performance.now();
  if (now - (lastAt.get(cue) ?? -1e9) < (COOLDOWN[cue] ?? 120)) return;
  if (voices >= 4) return;
  lastAt.set(cue, now);
  voices++;
  let dur = 0.3;
  const buf = buffers.get(cue);
  if (buf) {
    for (let i = 0; i < times; i++) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(master);
      src.start(ctx.currentTime + i * buf.duration);
    }
    dur = buf.duration * times;
  } else if (SYNTH[cue]) {
    dur = SYNTH[cue](); // plays once; the red synth already has its two whoops
  }
  setTimeout(() => { voices--; }, dur * 1000 + 50);
}
