// The six episodes of docs/DOMAIN.md section 8, in build order. A scenario is a script of timed steps that the
// scenario runner (server/src/ships/runner.js) plays against the simulators; see docs/PROTOCOL.md for the verbs.
import balance from './balance-of-terror.js';
import naked from './the-naked-time.js';
import doomsday from './the-doomsday-machine.js';
import mirror from './mirror-mirror.js';
import tribbles from './the-trouble-with-tribbles.js';
import seed from './space-seed.js';

const ALL = [balance, naked, doomsday, mirror, tribbles, seed];

/** id -> script. */
export const SCENARIOS = Object.fromEntries(ALL.map((s) => [s.id, s]));

/** What a dashboard shows in its scenario picker: no steps. */
export const SCENARIO_LIST = ALL.map(({ id, title, episode, summary, shows, ships, duration }) => ({ id, title, episode, summary, shows, ships, duration }));
