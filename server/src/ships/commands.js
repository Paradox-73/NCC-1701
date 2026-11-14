import { z } from 'zod';
import { LIMITS } from '@ncc/shared/schema.js';

// Shipboard commands: POST /api/ships/:id/command with { type, ...payload }. Which role may send which type is in
// shared/registry.js (ROLES[role].commands); this file holds the payload shapes and the words of each acknowledgement.
const deck = z.number().int().min(1).max(12);
const cmd = (type, shape = {}) => z.object({ type: z.literal(type), ...shape }).strict();

const UNION = z.discriminatedUnion('type', [
  cmd('helm.warp', { factor: z.number().min(0).max(9) }),
  cmd('helm.impulse', { percent: z.number().min(0).max(100) }),
  cmd('helm.heading', { deg: z.number().min(0).max(359.9).optional(), delta: z.number().min(-90).max(90).optional() }),
  cmd('helm.stop'),
  cmd('tactical.shields', { up: z.boolean() }),
  cmd('tactical.phasers', { bank: z.enum(['fore', 'aft']).default('fore') }),
  cmd('tactical.torpedo'),
  cmd('ship.condition', { level: z.enum(['normal', 'yellow', 'red']) }),
  cmd('comms.hail', { target: z.union([z.literal('command'), z.number().int().min(1).max(LIMITS.maxSourceId)]) }),
  cmd('comms.close'),
  cmd('engineering.allocate', { preset: z.enum(['cruise', 'combat', 'emergency']) }),
  cmd('engineering.coldRestart'),
  cmd('transporter.energize'),
  cmd('medical.inoculate', { deck: deck.optional() }),
  cmd('medical.quarantine', { deck }),
  cmd('science.scan', { mode: z.enum(['long', 'short', 'focus']) }),
  cmd('security.ventGas', { deck }),
  cmd('scenario.start', { id: z.string().regex(/^[a-z0-9-]{1,40}$/) }),
  cmd('scenario.stop'),
  cmd('sim.fault', { sourceId: z.number().int().min(1).max(LIMITS.maxSourceId).optional(), fault: z.enum(['mute', 'storm', 'spike', 'clear']), seconds: z.number().min(1).max(60).optional() }),
]);
export const COMMAND_SCHEMA = UNION.refine((c) => c.type !== 'helm.heading' || (c.deg === undefined) !== (c.delta === undefined), { message: 'give deg or delta' });

/** Commands that only make sense while a scenario waits for them: any other time they are refused with 409. */
export const SCENARIO_ONLY = new Set(['engineering.coldRestart', 'security.ventGas']);

const where = (d) => (d ? `deck ${d}` : 'all decks');
const TEXT = {
  'helm.warp': (c) => (c.factor === 0 ? 'Dropping out of warp, aye' : `Warp factor ${c.factor}, aye`),
  'helm.impulse': (c) => `Impulse power ${c.percent} percent, aye`,
  'helm.heading': (c) => (c.deg !== undefined ? `Heading ${c.deg}, aye` : `Coming about ${c.delta > 0 ? '+' : ''}${c.delta} degrees, aye`),
  'helm.stop': () => 'All stop, aye',
  'tactical.shields': (c) => (c.up ? 'Shields up' : 'Shields down'),
  'tactical.phasers': (c) => `Phasers fired, ${c.bank} bank`,
  'tactical.torpedo': () => 'Photon torpedo away',
  'ship.condition': (c) => ({ red: 'Red alert. All hands to battle stations', yellow: 'Yellow alert', normal: 'Standing down. Normal condition' })[c.level],
  'comms.hail': (c) => `Hailing ${c.target === 'command' ? 'Starfleet Command' : `ship ${c.target}`}, frequencies open`,
  'comms.close': () => 'Hailing frequencies closed',
  'engineering.allocate': (c) => `Power allocation ${c.preset}, aye`,
  'engineering.coldRestart': () => 'Cold restart of the warp core, aye',
  'transporter.energize': () => 'Energizing',
  'medical.inoculate': (c) => `Inoculating ${where(c.deck)}`,
  'medical.quarantine': (c) => `Deck ${c.deck} quarantined`,
  'science.scan': (c) => `${c.mode[0].toUpperCase()}${c.mode.slice(1)} scan under way`,
  'security.ventGas': (c) => `Venting anaesthetic gas, deck ${c.deck}`,
  'sim.fault': (c) => `Fault injection: ${c.fault}`,
};
/** The words of a command's acknowledgement, for the ship's log. */
export const ackText = (c) => TEXT[c.type]?.(c) ?? c.type;

/** The payload of a command without its type: what the simulator receives as `args`. */
export const argsOf = ({ type: _t, ...rest }) => rest;
