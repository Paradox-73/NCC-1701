// Season 1, 1966. An infection from the research station on Psi 2000 spreads by touch and makes people act as if
// drunk. A crewman shuts down the engines; the ship falls toward the planet; a cold restart of the warp core throws
// it 71 hours back in time. Shows the 430-crew biosign stream, medical privacy by role, orbit decay and the restart.
const timeWarp = -(71 * 3600e3) / 8_640_000; // 71 hours in stardate units, about -29.6

export default {
  id: 'the-naked-time',
  title: 'The Naked Time',
  episode: 'Season 1, 1966',
  summary: 'A drunken crew, a dead engine room and a planet getting closer: the cold restart.',
  shows: ['430-crew biosign stream', 'Medical privacy by role', 'Orbit decay', 'Cold restart'],
  ships: [1],
  duration: 100,
  steps: [
    { t: 0, log: 'Standard orbit of Psi 2000. Landing party back from the research station.', snap: { warp: 0, impulse: 10 }, set: { ch: 'orbitAlt', to: 400 }, fx: { name: 'viewscreen', scene: 'psi-2000' } },
    // Patient zero, crew 207 on deck 7.
    { t: 5, crew: [{ infect: [207] }, { set: { ids: [207], hr: 115, bt: 38.2, nr: 150, infected: true } }] },
    { t: 15, log: 'Sickbay: more crew report symptoms.', crew: { spread: { every: 8, max: 140 } } },
    { t: 40, log: 'Engineering not responding.', sound: 'alarm', ramp: [
      { ch: 'reactionRate', to: 0, over: 5 }, { ch: 'warpField', to: 0, over: 5 }, { ch: 'impulse', to: 0, over: 5 }, { ch: 'impulseReactor', to: 0, over: 5 },
      { ch: 'nacellePort', to: 0, over: 5 }, { ch: 'nacelleStbd', to: 0, over: 5 }, { ch: 'powerTotal', to: 20, over: 5 }, { ch: 'battery', to: 40, over: 38 },
    ] },
    { t: 50, log: 'The orbit is decaying.', sound: 'alarm', ramp: [{ ch: 'descentRate', to: 300, over: 10 }, { ch: 'orbitAlt', to: 150, over: 30 }, { ch: 'hullTemp', to: 600, over: 25 }], fx: { name: 'viewscreen', scene: 'planet-closing' } },
    { t: 70, log: 'Doctor: inoculate the crew.', await: { type: 'medical.inoculate' }, timeout: 5 },
    { t: 75, log: 'The infection is gone, but the engines are still cold.' },
    { t: 80, log: 'Cold restart of the warp core. Nobody has tried it before.', await: { type: 'engineering.coldRestart' }, timeout: 6 },
    { t: 81, ramp: [{ ch: 'reactionRate', to: 110, over: 2 }, { ch: 'warpField', to: 98, over: 2 }, { ch: 'warpFactor', to: 8, over: 2 }, { ch: 'descentRate', to: -100, over: 3 }, { ch: 'orbitAlt', to: 400, over: 15 }, { ch: 'powerTotal', to: 85, over: 3 }, { ch: 'nacellePort', to: 108, over: 2 }, { ch: 'nacelleStbd', to: 108, over: 2 }] },
    { t: 83, ramp: [{ ch: 'reactionRate', to: 64, over: 3 }, { ch: 'warpFactor', to: 0, over: 3 }, { ch: 'nacellePort', to: 63, over: 3 }, { ch: 'nacelleStbd', to: 63, over: 3 }, { ch: 'hullTemp', to: -10, over: 10 }] },
    { t: 85, log: 'Time warp: the stardate rolls back 71 hours.', sound: 'warp', fx: { name: 'timewarp', stardateDelta: timeWarp } },
    { t: 95, log: 'Stand down.', condition: 'normal' },
    { t: 98, end: true },
  ],
};
