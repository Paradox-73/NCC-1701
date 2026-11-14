// Bridge sound (DESIGN.md, Sound). On unless the user mutes it, and a mute lasts for the tab session only. Browsers
// start audio only after a user gesture, so the first pointer or key press anywhere creates the one AudioContext
// and loads every clip; later presses resume it if the browser suspended it. A clip is /sfx/<cue>.mp3 when the
// sound kit ships it, else a few lines of oscillator code stand in. Master gain -12 dB, at most 4 voices, a cooldown per cue.
// The original-series theme loops quietly under everything (see Music below); a mute suspends the whole context.
import { useSyncExternalStore } from 'react';

const MUTED = 'ncc.muted'; // sessionStorage, '1' once the user mutes
const CUES = ['press', 'ack', 'hail', 'intercom', 'yellow', 'red', 'station', 'lift', 'warp', 'chirp', 'phaser', 'torpedo', 'boom', 'transport', 'reactor', 'heartbeat'];
const COOLDOWN = { press: 60, ack: 150, red: 4500, yellow: 2500, station: 300, lift: 1000 };

let enabled = true;
try {
  localStorage.removeItem('ncc.sound'); // the old switch, kept forever: a stale '0' there silenced every later visit
  enabled = sessionStorage.getItem(MUTED) !== '1';
} catch { /* private mode */ }
let ctx = null;
let master = null;
let voices = 0;
const buffers = new Map();
const lastAt = new Map();
const listeners = new Set();

// a clip under client/public as an AudioBuffer, or null (missing, not audio, undecodable)
const load = (path) => fetch(`${import.meta.env.BASE_URL}${path}`)
  .then((r) => (r.ok && /audio/.test(r.headers.get('content-type') || '') ? r.arrayBuffer() : null))
  .then((b) => b && ctx.decodeAudioData(b))
  .catch(() => null);

function ensureContext() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.25; // -12 dB
  master.connect(ctx.destination);
  // headphones plugged in or paired after the page opened: follow the system's new default output, not the old one
  navigator.mediaDevices?.addEventListener?.('devicechange', () => { ctx.setSinkId?.('').catch(() => {}); });
  for (const cue of CUES) load(`sfx/${cue}.mp3`).then((buf) => buf && buffers.set(cue, buf)); // else the synth stands in
  load('audio/theme.mp3').then((buf) => buf && startMusic(buf));
}

// ---- music ---------------------------------------------------------------------------------------------------
// client/public/audio/theme.mp3 is the original-series end-credits theme, cut at 29.9 s. Its melody comes round again
// every 23.641 s, so after one pass from the start it loops 5.500 to 29.141 s, the pair of points where the two
// passes line up best, with an equal-power 0.5 s crossfade. About -27 LUFS, under the sound cues. It ducks out while
// the opening plays (that has its own music) and to a third under the red-alert klaxon.
const LOOP = { from: 5.5, to: 29.141, xf: 0.5 };
const MUSIC_LEVEL = 0.45;
const FADE_IN = Float32Array.from({ length: 32 }, (_, i) => Math.sin((i / 31) * (Math.PI / 2)));
const FADE_OUT = FADE_IN.slice().reverse();
const ducks = { intro: 1, alert: 1 };
let music = null; // the music's gain node, once the theme has loaded

/** Ducks the background music: `who` is 'intro' or 'alert', `to` the share of its level (1 lifts that duck). */
export function duckMusic(who, to, seconds = 0.4) {
  ducks[who] = to;
  music?.gain.setTargetAtTime(MUSIC_LEVEL * ducks.intro * ducks.alert, ctx.currentTime, seconds / 3);
}

function startMusic(buf) {
  music = ctx.createGain();
  music.gain.value = 0;
  music.connect(ctx.destination);
  duckMusic('intro', ducks.intro, 1.5); // fade in
  let when = ctx.currentTime + 0.05;
  let offset = 0;
  // keeps the next pass scheduled on the audio clock; a suspended (muted) clock stands still, so nothing piles up
  const queue = () => {
    while (when - ctx.currentTime < 3) {
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      src.buffer = buf;
      src.connect(g).connect(music);
      const len = LOOP.to - offset;
      if (offset) g.gain.setValueCurveAtTime(FADE_IN, when, LOOP.xf);
      g.gain.setValueCurveAtTime(FADE_OUT, when + len, LOOP.xf);
      src.start(when, offset);
      src.stop(when + len + LOOP.xf);
      when += len;
      offset = LOOP.from;
    }
  };
  queue();
  setInterval(queue, 1000);
}

// pointerdown is a mouse's activation, pointerup a finger's: either may be the first gesture
if (typeof window !== 'undefined') for (const type of ['pointerdown', 'pointerup', 'keydown']) window.addEventListener(type, () => { if (enabled) ensureContext(); }, true);

export const soundOn = () => enabled;
export function setSound(on) {
  enabled = on;
  try { if (on) sessionStorage.removeItem(MUTED); else sessionStorage.setItem(MUTED, '1'); } catch { /* private mode */ }
  if (on) ensureContext();
  else ctx?.suspend(); // silences the music and any cue still ringing
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
  boom: () => Math.max(noise(1.2, 700, 60, 0.6), tone('sine', 90, 35, 1.0, 0.5)),
  transport: () => Math.max(...[880, 887, 1320, 1331].map((f) => tone('sine', f, f * 1.5, 2.2, 0.08))),
  reactor: () => tone('sawtooth', 40, 220, 2.5, 0.2),
  heartbeat: () => tone('sine', 900, 500, 0.12, 0.3),
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
  if (cue === 'red') { duckMusic('alert', 1 / 3, 0.15); setTimeout(() => duckMusic('alert', 1, 1.2), dur * 1000); }
}
