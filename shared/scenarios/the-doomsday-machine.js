// Season 2, 1967. A planet-killing machine has wrecked the USS Constellation. It drains the Enterprise, wrecks its
// transporter and its subspace radio. The Constellation's impulse engines are rigged to explode inside the machine.
// Shows: several sources at once, the fleet view, link loss, and the history of a lost ship. Ships: Enterprise (1) and Constellation (2).
const CONSTELLATION = 2;
// the Constellation's link drops for 3 s every 10 s
const dropouts = Array.from({ length: 9 }, (_, k) => ({ t: k * 10, source: CONSTELLATION, fault: { fault: 'mute', seconds: 3 } }));

export default {
  id: 'the-doomsday-machine',
  title: 'The Doomsday Machine',
  episode: 'Season 2, 1967',
  summary: 'The Constellation is a wreck. The machine takes the Enterprise next, and the Constellation is its only weapon.',
  shows: ['Several sources and the fleet view', 'Link loss', 'History of a lost ship'],
  ships: [1, CONSTELLATION],
  duration: 105,
  steps: [
    { t: 0, log: "The Constellation's distress beacon.", sound: 'chirp', source: CONSTELLATION,
      set: [
        { ch: 'hullIntegrity', to: 30 }, { ch: 'shieldFore', to: 3 }, { ch: 'shieldAft', to: 0 }, { ch: 'shieldPort', to: 5 }, { ch: 'shieldStbd', to: 2 },
        { ch: 'powerTotal', to: 10 }, { ch: 'warpFactor', to: 0 }, { ch: 'lrSensor', to: 20 }, { ch: 'crewAboard', to: 1 }, { ch: 'carrier', to: 8 },
      ] },
    ...dropouts,
    { t: 10, log: 'The Enterprise heads for the Constellation at warp 6.', cmd: { type: 'helm.heading', deg: 56 } },
    { t: 20, log: 'Contact: an object miles long.', sound: 'alarm', contact: { n: 1, bearing: 56, range: 400000 }, ramp: { ch: 'contactSnr', to: 40, over: 2 }, condition: 'red' },
    { t: 23, ramp: { ch: 'contactRange', to: 30000, over: 14 } },
    { t: 30, log: 'The machine drains the shields, the transporter and the subspace radio.', sound: 'alarm',
      hit: { quad: 'all', amount: 25 },
      set: { ch: 'xpState', to: 3 }, ramp: [{ ch: 'carrier', to: 15, over: 4 }, { ch: 'loss', to: 25, over: 4 }] },
    { t: 32, hit: { quad: 'all', amount: 25 } },
    { t: 34, hit: { quad: 'all', amount: 25 } },
    { t: 36, hit: { quad: 'all', amount: 25 } },
    { t: 38, hit: { quad: 'all', amount: 25 } },
    { t: 45, log: 'Phasers. No effect on neutronium. A tractor beam pulls the ship in.', await: { type: 'tactical.phasers' }, timeout: 4 },
    { t: 46, ramp: [{ ch: 'hullStress', to: 85, over: 8 }, { ch: 'speed', to: 40, over: 8 }, { ch: 'contactRange', to: 15000, over: 8 }] },
    { t: 55, log: "The Constellation's last phaser bank distracts the machine. The Enterprise breaks free.", source: CONSTELLATION, set: { ch: 'phaserFore', to: 0 } },
    { t: 55, ramp: [{ ch: 'hullStress', to: 20, over: 6 }], release: { ch: ['speed'], over: 5 } },
    { t: 65, log: "The Constellation's impulse engines are rigged. Thirty seconds.", sound: 'alarm', source: CONSTELLATION, ramp: { ch: 'impulseReactor', to: 128, over: 30 } },
    { t: 80, log: 'Energize: bring the pilot back. The transporter fails first.', await: { type: 'transporter.energize' }, timeout: 4 },
    { t: 81, ramp: [{ ch: 'xpPattern', to: 90, over: 2 }], set: { ch: 'xpLock', to: 78 }, noise: { ch: 'xpLock', sigma: 10 } },
    { t: 87, log: 'The pilot is back aboard.', release: { ch: ['xpState', 'xpLock', 'xpPattern'], over: 3 } },
    { t: 95, log: 'The Constellation explodes inside the machine.', sound: 'boom', source: CONSTELLATION, fault: { fault: 'lost' } },
    { t: 95, ramp: { ch: 'contactSnr', to: 0, over: 2 }, contact: { n: 0 } },
    { t: 103, log: 'Stand down. The Constellation is lost.', condition: 'normal' },
    { t: 105, end: true },
  ],
};
