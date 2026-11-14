// Season 1, 1966. Romulans destroy outposts along the Neutral Zone with a ship that can turn invisible.
// Shows: statistical anomaly detection (the sensor ghost has no fixed limit), red alert, commands with
// acknowledgements, shield hits. Steps after an `await` start counting from the moment the awaited command arrives.
export default {
  id: 'balance-of-terror',
  title: 'Balance of Terror',
  episode: 'Season 1, 1966',
  summary: 'A cloaked Romulan ship hunts Earth outposts. Only the statistics see it before it fires.',
  shows: ['Statistical anomaly detection', 'Red alert and acknowledged commands', 'Shield hits'],
  ships: [1],
  duration: 90,
  steps: [
    { t: 0, log: 'Outpost 4 reports an attack by a ship nobody can see.', sound: 'chirp' },
    { t: 0, cmd: { type: 'helm.warp', factor: 6 } },
    { t: 8, log: 'Outpost 4: signal lost.' },
    // A weak, broken return: far below any fixed limit, far above the noise floor of 2 dB.
    { t: 12, set: [{ ch: 'contactRange', to: 80000 }, { ch: 'contactBearing', to: 40 }], ramp: [{ ch: 'contactSnr', to: 7, over: 2 }, { ch: 'contactBearing', to: 55, over: 20 }], noise: { ch: 'contactSnr', sigma: 1 } },
    { t: 20, log: 'Something is out there. Captain to the bridge.', await: { type: 'ship.condition', level: 'red' }, timeout: 6 },
    { t: 30, log: 'The ship appears and fires a plasma torpedo.', sound: 'alarm', contact: { n: 1, bearing: 55, range: 60000 }, ramp: { ch: 'contactSnr', to: 25, over: 1 }, hit: { quad: 'fore', amount: 45 } },
    { t: 38, log: 'A second torpedo.', hit: { quad: 'fore', amount: 50, hull: 8 } },
    { t: 40, log: 'It has vanished again.', contact: { n: 0 }, ramp: { ch: 'contactSnr', to: 7, over: 1 } },
    { t: 45, log: 'Debris ahead, with a metal-cased object. Phasers.', contact: { n: 2, bearing: 80, range: 90000 }, await: { type: 'tactical.phasers' }, timeout: 5 },
    { t: 50, log: 'The phaser shot sets off a hidden nuclear weapon. The blast shakes the ship.', sound: 'alarm', hit: { quad: 'all', amount: 10 }, ramp: { ch: 'phaserTemp', to: 62, over: 1 } },
    { t: 58, log: 'Coolant leak in phaser control.', ramp: { ch: 'phaserTemp', to: 115, over: 12 } },
    { t: 72, log: 'The enemy appears to fire. Phasers.', await: { type: 'tactical.phasers' }, timeout: 8 },
    { t: 75, log: 'A hit. The enemy commander destroys his own ship.', ramp: { ch: 'contactSnr', to: 0, over: 1 }, contact: { n: 0 } },
    { t: 85, log: 'Stand down.', condition: 'normal' },
    { t: 88, end: true },
  ],
};
