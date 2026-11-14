// PLACEHOLDER physics: every registry channel wanders around its `nominal` value with a slow wave and a little noise,
// so it runs with any registry. Domain-specific behaviour (a warp core that heats under load, shields that fall
// under fire) belongs in scenario scripts that send commands (commands.js), not here.
import { CHANNELS } from '@ncc/shared/schema.js';
import { COMMANDS } from './commands.js';

const WAVE = 0.004; // wave amplitude as a share of a channel's range
const NOISE = 0.0015; // noise amplitude as a share of a channel's range

export class Ship {
  constructor(sourceId, { rand = Math.random } = {}) {
    this.sourceId = sourceId;
    this.rand = rand;
    this.t = 0;
    this.faults = new Map(); // channel key -> { target, from, at, rampSec }: the channel moves to `target` over rampSec and stays
    this.waves = CHANNELS.map(() => ({ phase: rand() * 2 * Math.PI, period: 20 + rand() * 60 }));
  }

  /** Runs a command from the server (`sim:command`) through the handlers in commands.js. Returns false for an unknown type. */
  command(cmd) {
    const handler = COMMANDS[cmd?.type];
    if (!handler) return false;
    handler(this, cmd.args ?? {});
    return true;
  }

  /** Advances `dt` seconds and returns every channel's real value for the sample stamped `ts`. */
  step(dt, ts) {
    this.t += dt;
    this.lastTs = ts;
    const out = {};
    CHANNELS.forEach((c, i) => {
      const range = c.max - c.min;
      const w = this.waves[i];
      let v = c.nominal + range * WAVE * Math.sin((2 * Math.PI * this.t) / w.period + w.phase) + range * NOISE * (this.rand() + this.rand() - 1);
      const f = this.faults.get(c.key);
      if (f) {
        const k = Math.min(1, (ts - f.at) / (f.rampSec * 1000));
        v = v + (f.target - v) * k;
      }
      out[c.key] = Math.min(c.max, Math.max(c.min, v));
    });
    return out;
  }
}
