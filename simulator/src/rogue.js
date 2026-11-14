// A rogue source, for the Space Seed scenario and the load test: it tries to feed the server false data in three
// phases, each of which the server must refuse and report.
//   auth     five handshakes with a wrong device key, claiming to be the Enterprise      -> ingest-auth
//   invalid  a stolen key, readings out of range (oxygen on deck 1 at -5 %)              -> ingest-invalid
//   flood    a stolen key, valid-looking samples at about 5,000 a second                 -> ingest-flood
// The stolen-key phases use source 99, which is on no roster, so they never replace a real ship's connection.
import { io } from 'socket.io-client';
import parser from 'socket.io-msgpack-parser';
import { EVENTS, channelsOf, packSample } from '@ncc/shared/schema.js';

export const ROGUE_SOURCE = 99;
const NOMINAL = Object.fromEntries(channelsOf(1).map((c) => [c.key, c.nominal]));
const link = (url, auth) => io(`${url.replace(/\/$/, '')}/ingest`, { parser, transports: ['websocket'], auth, reconnection: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs one phase; resolves with { sent } when it is over. `key` is the real device key, which the rogue pretends to have stolen. */
export async function rogue({ url, key, phase, seconds = 5, sourceId = ROGUE_SOURCE }) {
  if (phase === 'auth') {
    let refused = 0;
    for (let i = 0; i < 5; i++) {
      const s = link(url, { sourceId: 1, key: `guess-${i}` });
      await new Promise((res) => {
        s.once('connect_error', () => { refused++; res(); });
        s.once('connect', res);
      });
      s.close();
      await sleep(300);
    }
    return { sent: refused };
  }
  const s = link(url, { sourceId, key });
  await new Promise((res, rej) => { s.once('connect', res); s.once('connect_error', rej); });
  let sent = 0;
  let seq = Math.floor(Date.now() / 20);
  const bad = Object.assign({}, NOMINAL, { o2_01: -5 });
  const batch = (values, n) => Array.from({ length: n }, () => packSample(seq++, Date.now(), values, 1));
  const perTick = phase === 'flood' ? 100 : 40; // 50 ticks a second: 5,000 and 2,000 samples a second
  const end = Date.now() + seconds * 1000;
  // o2_01 = -5 is below the channel minimum, so packSample's integer is out of range on the wire
  while (Date.now() < end) {
    s.emit(EVENTS.BATCH, { sourceId, samples: batch(phase === "flood" ? NOMINAL : bad, perTick) });
    sent += perTick;
    await sleep(20);
  }
  s.close();
  return { sent };
}
