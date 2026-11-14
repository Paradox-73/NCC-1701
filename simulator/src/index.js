// Simulated sources: `npm start -w simulator -- --url http://localhost:4000 --key <DEVICE_KEY>`
// One source per entry of SOURCES: four ships and four sickbay hubs (the hubs of ships 2-4 only when the profile is
// local). Each ship runs its physics (physics.js); a sickbay hub streams the vitals of its ship's crew (crew.js).
import { pathToFileURL } from 'node:url';
import { SOURCES, packSample } from '@ncc/shared/schema.js';
import { Ship } from './physics.js';
import { rogue } from './rogue.js';
import { Sender } from './sender.js';

function args() {
  const a = Object.fromEntries(
    process.argv.slice(2).flatMap((x, i, all) => (x.startsWith('--') ? [[x.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : [])),
  );
  return {
    url: a.url ?? process.env.SIM_URL ?? 'http://localhost:4000',
    sources: Number(a.sources ?? process.env.SIM_SOURCES ?? SOURCES.length), // the first N registry sources
    hz: a.hz ?? process.env.SIM_HZ ? Number(a.hz ?? process.env.SIM_HZ) : null, // null: each source's own rate from the registry
    profile: a.profile ?? process.env.SIM_PROFILE ?? 'local', // 'hosted' uses the lower rates of a free hosting tier
    key: a.key ?? process.env.DEVICE_KEY ?? 'dev-device-key',
    seconds: Number(a.seconds ?? 0), // 0 = run until Ctrl+C
  };
}

// seq counts sample slots since 1 Jan 2026 UTC, so it is gap-free at a steady rate and a restarted
// simulator continues above the last seq the server remembers instead of being dropped as duplicates.
const SEQ_EPOCH = Date.UTC(2026, 0, 1);

// A mute stops sending for a while; the samples made meanwhile go out afterwards as a burst
// with some duplicated and some reordered, which is what a recovering data logger does.
export function scramble(samples, rand = Math.random) {
  const out = samples.slice();
  for (let i = 0; i + 1 < out.length; i++) if (rand() < 0.2) [out[i], out[i + 1]] = [out[i + 1], out[i]];
  for (const s of samples) if (rand() < 0.05) out.splice(Math.floor(rand() * (out.length + 1)), 0, s.slice());
  return out;
}

/**
 * An ion storm on the link: 10% of samples are sent twice, 10% are held back up to 2 s (they arrive late, inside the
 * server's reorder window), 1% are held 6 s (older than the window: the server counts them stale), and for 2% an
 * out-of-range copy is sent as well. The sample stream itself stays complete, so the charts stay clean.
 * `held` collects { due, s }; `release(now)` returns the held samples that are due.
 */
export function storm(samples, held, now, rand = Math.random) {
  const out = [];
  for (const s of samples) {
    const r = rand();
    if (r < 0.01) held.push({ due: now + 6000, s });
    else if (r < 0.11) held.push({ due: now + rand() * 2000, s });
    else out.push(s);
    if (rand() < 0.1) out.push(s.slice());
    if (rand() < 0.02) {
      const bad = s.slice();
      bad[2] = 99_999_999;
      out.push(bad);
    }
  }
  return out;
}
export function dueFrom(held, now) {
  const due = [];
  for (let i = held.length - 1; i >= 0; i--) if (held[i].due <= now) due.push(...held.splice(i, 1).map((h) => h.s));
  return due;
}

export function start(cfg) {
  const ships = new Map(); // ship id -> Ship, shared by a ship's stream and its sickbay hub
  const shipFor = (id) => ships.get(id) ?? (ships.set(id, new Ship(id)), ships.get(id));
  const entries = SOURCES.slice(0, cfg.sources)
    .map((src) => ({ src, hz: cfg.hz ?? (cfg.profile === 'hosted' ? src.hostedHz : src.hz) }))
    .filter((e) => e.hz > 0)
    .map(({ src, hz }) => {
      const stepMs = 1000 / hz;
      // slot: index of the source's next sample since SEQ_EPOCH. Counting it as an integer keeps seq unique at rates
      // like 60 Hz, where a slot is not a whole number of ms and rounding the ts first gave two samples one seq.
      const e = { src, hz, stepMs, ship: shipFor(src.kind === 'crew' ? src.ship : src.id), slot: Math.ceil((Date.now() - SEQ_EPOCH) / stepMs), mute: null, stormUntil: 0, lost: false, lostUntil: 0, held: [], late: [] };
      e.sender = new Sender({
        url: cfg.url,
        sourceId: src.id,
        key: cfg.key,
        hooks: {
          onState: (s) => console.log(`source ${src.id}: ${s}`),
          onCommand: (cmd) => onCommand(e, cmd),
        },
      });
      return e;
    });

  function onCommand(e, cmd) {
    console.log(`source ${e.src.id}: command ${JSON.stringify(cmd)}`);
    const a = cmd?.args ?? {};
    const secs = (Number(a.seconds) || 5) * 1000;
    if (cmd?.type === 'mute') e.mute = Date.now() + (Number(a.seconds) || 3) * 1000;
    else if (cmd?.type === 'fault.storm') e.stormUntil = Date.now() + secs;
    else if (cmd?.type === 'scn.fault') {
      if (a.fault === 'mute') e.mute = Date.now() + secs;
      else if (a.fault === 'storm') e.stormUntil = Date.now() + secs;
      else if (a.fault === 'lost') e.lost = true; // the ship is gone: nothing is sent, and nothing is sent later to make up for it
      else if (a.fault === 'spike') e.ship.command({ type: 'fault.spike' });
    } else if (cmd?.type === 'scn.rogue') rogue({ url: cfg.url, key: cfg.key, phase: a.phase, seconds: a.seconds }).catch((err) => console.log(`rogue ${a.phase}: ${err.message}`));
    else if (cmd?.type === 'scn.release') {
      e.stormUntil = 0; // the storm passes
      if (e.lost) e.lostUntil = Date.now() + 30_000; // a lost ship restarts in calm running 30 s after the scenario
      if (e.src.kind === 'ship') e.ship.command(cmd);
    } else if (e.src.kind === 'ship') e.ship.command(cmd); // a sickbay hub takes no ship commands: its ship's own link already got them
  }

  console.log(`${entries.length} sources to ${cfg.url} (${cfg.profile}): ${entries.map((e) => `${e.src.id} ${e.src.name} at ${e.hz} Hz`).join('; ')}`);

  // One loop for all sources: every sample gets the timestamp it would have had at a steady rate,
  // so a late timer tick produces several samples instead of a gap.
  const loop = setInterval(() => {
    const now = Date.now();
    for (const e of entries) {
      let batch = [];
      while (SEQ_EPOCH + e.slot * e.stepMs <= now) {
        const ts = Math.round(SEQ_EPOCH + e.slot * e.stepMs);
        e.slot++;
        const values = e.src.kind === 'crew' ? e.ship.crew.values() : e.ship.step(1 / e.hz, ts);
        batch.push(packSample(e.slot, ts, values, e.src.id));
      }
      if (e.lost && (!e.lostUntil || now < e.lostUntil)) continue;
      e.lost = false;
      if (e.stormUntil > now) batch = storm(batch, e.late, now);
      if (e.late.length) batch.push(...dueFrom(e.late, e.stormUntil > now ? now : Infinity));
      if (e.mute && now >= e.mute) {
        e.mute = null;
        e.sender.push(scramble(e.held));
        e.held = [];
      }
      if (e.mute) e.held.push(...batch);
      else e.sender.push(batch);
    }
  }, 20);

  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(loop);
    const t = entries.reduce((a, e) => ({ sent: a.sent + e.sender.stats.sentSamples, acked: a.acked + e.sender.stats.ackedSamples, dups: a.dups + e.sender.stats.duplicates, dropped: a.dropped + e.sender.stats.dropped }), { sent: 0, acked: 0, dups: 0, dropped: 0 });
    console.log(`stopping: sent ${t.sent}, acked ${t.acked}, server duplicates ${t.dups}, dropped locally ${t.dropped}`);
    setTimeout(() => entries.forEach((e) => e.sender.close()), 300);
  }
  return { entries, ships, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = args();
  const sim = start(cfg);
  const quit = () => {
    sim.stop();
    setTimeout(() => process.exit(0), 400);
  };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
  if (cfg.seconds > 0) setTimeout(quit, cfg.seconds * 1000);
}
