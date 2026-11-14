// The one requestAnimationFrame loop. Charts and the map register a draw function here;
// nothing else in the app schedules its own animation frames.
const fns = new Set();
let running = false;
let last = 0;
let frames = 0;
export const frameStats = { fps: 0, dropped: 0 };

function loop(t) {
  if (last) {
    const dt = t - last;
    frames++;
    if (dt > 25 && dt < 1000) frameStats.dropped += Math.round(dt / 16.7) - 1; // frames the browser skipped
  }
  last = t;
  for (const fn of fns) fn(t);
  if (fns.size) requestAnimationFrame(loop); else { running = false; last = 0; }
}

export function onFrame(fn) {
  fns.add(fn);
  if (!running) { running = true; requestAnimationFrame(loop); }
  return () => fns.delete(fn);
}

setInterval(() => { frameStats.fps = frames; frames = 0; }, 1000);
