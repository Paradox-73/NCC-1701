// The simulator's Sender against a stand-in ingest server that throttles and refuses: no sample may be lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import parser from 'socket.io-msgpack-parser';
import { Sender } from '../../simulator/src/sender.js';

test('samples the server throttled or refused are sent again, in order, until every one is accepted', async () => {
  const http = createServer();
  const io = new Server(http, { parser });
  const got = new Set();
  let n = 0;
  io.of('/ingest').on('connection', (socket) => {
    socket.on('telemetry:batch', ({ samples }, ack) => {
      n++;
      if (n % 5 === 0) return ack({ ok: false, accepted: 0, invalid: 0, throttled: samples.length, credit: 0 }); // batch rate limit: the whole batch is refused
      const kept = n % 3 === 0 ? samples.slice(0, Math.floor(samples.length / 2)) : samples; // token bucket: the last samples are dropped
      kept.forEach((s) => got.add(s[0]));
      ack({ ok: true, accepted: kept.length, throttled: samples.length - kept.length, credit: 1 });
    });
  });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const sender = new Sender({ url: `http://127.0.0.1:${http.address().port}`, sourceId: 7, key: 'k' });
  sender.push(Array.from({ length: 600 }, (_, i) => [i + 1, 1_800_000_000_000 + i * 20]));
  const until = Date.now() + 15_000;
  while (got.size < 600 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  sender.close();
  await new Promise((r) => io.close(r));
  assert.equal(got.size, 600, `server got ${got.size} of 600 samples, ${sender.stats.dropped} dropped locally`);
});
