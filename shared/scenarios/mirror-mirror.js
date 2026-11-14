// Season 2, 1967. An ion storm hits during a beam-up from the Halkan planet and swaps the landing party with their
// counterparts from a parallel universe. Shows: duplicate, out-of-order and malformed telemetry, and how the server's
// de-duplication and validation keep the charts clean. Ship: Enterprise and its crew hub.
const FOUR = { from: 1, to: 4 }; // crew 001-004, the landing party

export default {
  id: 'mirror-mirror',
  title: 'Mirror, Mirror',
  episode: 'Season 2, 1967',
  summary: 'An ion storm scrambles the link and the transporter. The server keeps the charts clean.',
  shows: ['Duplicate, out-of-order and malformed telemetry', 'Validation and de-duplication counters'],
  ships: [1],
  duration: 60,
  steps: [
    { t: 0, log: 'Orbit of the Halkan planet. The Halkan Council refuses. Landing party beaming up.', set: { ch: 'orbitAlt', to: 400 }, fx: { name: 'viewscreen', scene: 'halkan' } },
    { t: 5, log: 'An ion storm builds.', sound: 'alarm', ramp: [{ ch: 'ionFlux', to: 75, over: 20 }, { ch: 'interference', to: 70, over: 20 }, { ch: 'carrier', to: 15, over: 20 }, { ch: 'loss', to: 35, over: 20 }] },
    { t: 15, log: 'The storm scrambles the telemetry link.', fault: { fault: 'storm', seconds: 40 } },
    { t: 25, log: 'Beam-up in the storm.', cmd: { type: 'transporter.energize' }, set: [{ ch: 'xpLock', to: 60 }, { ch: 'xpPattern', to: 96 }] },
    { t: 30, log: 'The landing party arrives, wrong.', sound: 'chirp', crew: { shift: { ids: FOUR, nr: 35 } } },
    { t: 45, log: 'Chief engineer: emergency power, then energize.', await: { type: 'engineering.allocate', preset: 'emergency' }, timeout: 6 },
    { t: 46, await: { type: 'transporter.energize' }, timeout: 6 },
    { t: 47, ramp: [{ ch: 'xpEnergy', to: 34, over: 1 }, { ch: 'xpLock', to: 100, over: 2 }, { ch: 'xpPattern', to: 100, over: 2 }], crew: { recover: FOUR, over: 5 } },
    { t: 51, release: { ch: ['xpEnergy'], over: 2 } },
    { t: 55, log: 'The storm passes.', release: { ch: ['ionFlux', 'interference', 'carrier', 'loss', 'xpLock', 'xpPattern'], over: 8 } },
    { t: 62, end: true },
  ],
};
