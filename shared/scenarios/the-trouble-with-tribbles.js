// Season 2, 1967. A tribble comes aboard as a gift. Tribbles multiply by 11 every 10 s, get into the grain stores and
// fill the ship until the engineer beams them all over to the Klingon ship. Shows life support deck by deck, cascading
// alerts and a growth forecast from history. Ship: Enterprise.
//
// The population is lifeforms = 11^(t/10) until the grain is found poisoned at t 45, when growth halves its exponent.
// Each deck has its own local population from the second the tribbles reach it: deck 9 (food stores) first, then the
// vents carry them to decks 10, 6, 5, 3 and 2. Carbon dioxide and oxygen follow the local population.
const DECKS = [[9, 0], [10, 8], [6, 18], [5, 28], [3, 38], [2, 48]]; // [deck, second the tribbles arrive]
const GRAIN_POISONED = 45;
const END = 60;
const pad = (n) => String(n).padStart(2, '0');
const lifeforms = (t) => (t <= GRAIN_POISONED ? 11 ** (t / 10) : 11 ** (GRAIN_POISONED / 10) * 11 ** ((t - GRAIN_POISONED) / 20));
const localPop = (deck, arrive, t) => (t < arrive ? 0 : 11 ** (((deck === 9 ? Math.min(t, GRAIN_POISONED) : t) - arrive) / 10));

const growth = [];
for (let t = 0; t < END; t++) {
  const step = { t, ramp: [{ ch: 'lifeforms', to: Math.round(lifeforms(t + 1)), over: 1 }] };
  for (const [deck, arrive] of DECKS) {
    if (t + 1 < arrive) continue;
    const pop = localPop(deck, arrive, t + 1);
    step.ramp.push({ ch: `co2_${pad(deck)}`, to: Math.min(19000, Math.round(600 + 350 * pop)), over: 1 }, { ch: `o2_${pad(deck)}`, to: Math.max(14, Math.round((20.9 - 0.06 * pop) * 100) / 100), over: 1 });
    if (t + 1 === arrive) step.ramp.push({ ch: `temp_${pad(deck)}`, to: 23.5, over: 20 });
  }
  growth.push(step);
}
const ALL = DECKS.flatMap(([d]) => [`co2_${pad(d)}`, `o2_${pad(d)}`, `temp_${pad(d)}`]);

export default {
  id: 'the-trouble-with-tribbles',
  title: 'The Trouble with Tribbles',
  episode: 'Season 2, 1967',
  summary: 'One tribble becomes 1.7 million in a minute. The carbon dioxide gets there first.',
  shows: ['Life support deck by deck', 'Cascading alerts', 'Growth forecast from history'],
  ships: [1],
  duration: 80,
  steps: [
    { t: 0, log: 'Shore leave on the station. A gift comes aboard.', sound: 'chirp', set: { ch: 'lifeforms', to: 1 } },
    ...growth,
    { t: 30, log: 'Science shows the forecast.', fx: { name: 'forecast', channel: 'lifeforms' } },
    { t: GRAIN_POISONED, log: 'Many tribbles in the grain hold are dead: the grain was poisoned.' },
    { t: END, log: 'Beam them all over to the Klingon ship.', await: { type: 'transporter.energize' }, timeout: 8 },
    { t: END + 1, log: 'Beamed them into the Klingon engine room.', sound: 'chirp', ramp: [{ ch: 'xpEnergy', to: 38, over: 2 }, { ch: 'lifeforms', to: 0, over: 3 }] },
    { t: END + 5, release: [{ ch: ALL, over: 20 }, { ch: ['xpEnergy'], over: 3 }] },
    { t: 78, log: 'Stand down.', condition: 'normal' },
    { t: 80, end: true },
  ],
};
