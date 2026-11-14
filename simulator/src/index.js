// Simulated sources: `npm start -w simulator -- --url http://localhost:4000 --sources 3 --hz 10 --key <DEVICE_KEY>`
import { SOURCES, packSample } from '@ncc/shared/schema.js';
import { Ship } from './physics.js';
import { Sender } from './sender.js';

function args() {
  const a = Object.fromEntries(
    process.argv.slice(2).flatMap((x, i, all) => (x.startsWith('--') ? [[x.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : [])),
  );
  return {
    url: a.url ?? process.env.SIM_URL ?? 'http://localhost:4000',
    sources: Number(a.sources ?? process.env.SIM_SOURCES ?? SOURCES.length), // the first N registry sources
    hz: a.hz ?? process.env.SIM_HZ ? Number(a.hz ?? process.env.SIM_HZ) : null, // null: each source's own rate from the registry
    key: a.key ?? process.env.DEVICE_KEY ?? 'dev-device-key',
    seconds: Number(a.seconds ?? 0), // 0 = run until Ctrl+C
  };
}

const cfg = args();
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

const entries = SOURCES.slice(0, cfg.sources).map((src) => {
  const hz = cfg.hz ?? src.hz;
  const stepMs = 1000 / hz;
  // slot: index of the source's next sample since SEQ_EPOCH. Counting it as an integer keeps seq unique at rates
  // like 60 Hz, where a slot is not a whole number of ms and rounding the ts first gave two samples one seq.
  const e = { src, hz, stepMs, ship: new Ship(src.id), slot: Math.ceil((Date.now() - SEQ_EPOCH) / stepMs), mute: null, held: [] };
  e.sender = new Sender({
    url: cfg.url,
    sourceId: src.id,
    key: cfg.key,
    hooks: {
      onState: (s) => console.log(`source ${src.id}: ${s}`),
      onCommand: (cmd) => {
        console.log(`source ${src.id}: command ${JSON.stringify(cmd)}`);
        if (cmd?.type === 'mute') e.mute = Date.now() + (Number(cmd.args?.seconds) || 3) * 1000;
        else e.ship.command(cmd);
      },
    },
  });
  return e;
});

console.log(`${entries.length} sources to ${cfg.url}: ${entries.map((e) => `${e.src.id} ${e.src.name} at ${e.hz} Hz`).join('; ')}`);

// One loop for all sources: every sample gets the timestamp it would have had at a steady rate,
// so a late timer tick produces several samples instead of a gap.
const loop = setInterval(() => {
  const now = Date.now();
  for (const e of entries) {
    const batch = [];
    while (SEQ_EPOCH + e.slot * e.stepMs <= now) {
      const ts = Math.round(SEQ_EPOCH + e.slot * e.stepMs);
      e.slot++;
      batch.push(packSample(e.slot, ts, e.ship.step(1 / e.hz, ts)));
    }
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
  setTimeout(() => {
    entries.forEach((e) => e.sender.close());
    process.exit(0);
  }, 300);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
if (cfg.seconds > 0) setTimeout(stop, cfg.seconds * 1000);
