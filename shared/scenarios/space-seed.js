// Season 1, 1967. The Enterprise wakes Khan from cold sleep and he takes the ship. Shows device keys, rate limiting,
// rejected forged data and role-checked commands. Three phases of a rogue source hit /ingest (simulator/src/rogue.js);
// the server's own counters raise the ingest alerts. Ship: Enterprise and its crew hub.
const CAPTAIN_ON_DECK_1 = [1];
const cut = (deck, t) => ({
  t,
  log: `Khan cuts life support on deck ${deck}.`,
  ramp: [{ ch: `press_${String(deck).padStart(2, '0')}`, to: 70, over: 15 }, { ch: `o2_${String(deck).padStart(2, '0')}`, to: 15, over: 15 }, { ch: `temp_${String(deck).padStart(2, '0')}`, to: 8, over: 15 }],
});

export default {
  id: 'space-seed',
  title: 'Space Seed',
  episode: 'Season 1, 1967',
  summary: 'A forged data feed, a flood and a hijacked ship. The server refuses all of it.',
  shows: ['Device keys', 'Rate limiting', 'Rejected forged data', 'Role-checked commands'],
  ships: [1],
  duration: 85,
  steps: [
    { t: 0, log: 'Sleeper ship found adrift; taken in tow.', ramp: [{ ch: 'powerTotal', to: 92, over: 3 }, { ch: 'speed', to: 20, over: 3 }] },
    { t: 10, log: 'Someone tries to feed the ship false data, with the wrong device key.', sound: 'alarm', rogue: { phase: 'auth' } },
    { t: 18, log: 'It tries again with a stolen key and readings out of range.', rogue: { phase: 'invalid', seconds: 5 } },
    { t: 25, log: 'Now it floods the link, thousands of samples a second.', rogue: { phase: 'flood', seconds: 5 } },
    cut(1, 30),
    cut(2, 40),
    cut(3, 50),
    { t: 45, log: 'The captain is in the decompression chamber.', crew: { set: { ids: CAPTAIN_ON_DECK_1, hr: 155, rr: 36 } } },
    { t: 60, log: 'Vent anaesthetic gas through the ship.', await: { type: 'security.ventGas', deck: 11 }, timeout: 8 },
    { t: 61, log: 'The gas takes engineering. Life support recovers deck by deck.', crew: [{ sedate: 11 }, { recover: CAPTAIN_ON_DECK_1, over: 5 }], release: { ch: ['press_01', 'o2_01', 'temp_01'], over: 8 } },
    { t: 65, release: { ch: ['press_02', 'o2_02', 'temp_02'], over: 8 } },
    { t: 69, release: { ch: ['press_03', 'o2_03', 'temp_03'], over: 8 } },
    { t: 75, log: 'Khan reaches engineering and tries to destroy the ship.', ramp: { ch: 'chamberTemp', to: 75, over: 3 } },
    { t: 79, release: { ch: ['chamberTemp'], over: 4 } },
    { t: 85, log: 'Khan and his people are exiled to Ceti Alpha V.', condition: 'normal' },
    { t: 88, end: true },
  ],
};
