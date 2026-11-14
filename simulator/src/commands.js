// The command hook. The server relays `POST /api/sim/:sourceId/command` bodies to a source as `sim:command`
// events ({ type, args }); Ship.command() looks the type up here. A scenario script adds its own commands by adding
// entries to COMMANDS, each a function (ship, args), and needs no change anywhere else.
import { CHANNEL_BY_KEY } from '@ncc/shared/schema.js';

export const COMMANDS = {
  /** args: { channel, target, rampSec = 20 }. Moves one channel to `target` over rampSec seconds and holds it there. */
  fault(ship, { channel, target, rampSec = 20 }) {
    const c = CHANNEL_BY_KEY[channel];
    if (!c || !Number.isFinite(target)) return;
    ship.faults.set(channel, { target: Math.min(c.max, Math.max(c.min, target)), at: ship.lastTs || Date.now(), rampSec: Math.max(0.1, rampSec) });
  },
  /** Removes every fault: channels go back to nominal. */
  clear(ship) {
    ship.faults.clear();
  },
};

/** Stream-level commands (about sending, not about values) are handled by index.js: `mute` with { seconds }. */
export const STREAM_COMMANDS = new Set(['mute']);
