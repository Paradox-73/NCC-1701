# Performance

Stress runs of the `loadtest` package against a local stack, 14 Nov 2026. Each source is a ship sending its `helm` and `warp` channels at the stated rate over Socket.IO `/ingest`. Each dashboard client logs in as Starfleet Command, subscribes to every load-test source, and times each sample from the source's timestamp to its arrival on the client.

**Setup.** One Apple M2 laptop (8 cores, 8 GB) running everything: the server (Node 25, `SIM_EMBED=1`, so the full simulator ran in the same process: 4 ships at 50, 20, 20 and 20 Hz plus 4 sickbay hubs with 430 crew), MongoDB 8.2 and the load-test workers. The load-test sources are on top of the simulator's traffic. The server used the default timers (frames every 50 ms, writer flush every 250 ms).

## Results

| Run | Sources × rate | Dashboard clients | Samples accepted / s | Ack round trip p50 / p95 / p99 | End to end p50 / p95 / p99 (max) | Errors |
|---|---|---|---|---|---|---|
| `smoke` (15 s) | 5 × 10 Hz | 5 | 50 | 1 / 4 / 11 ms | 101 / 159 / 188 ms (189) | 0 |
| **`medium`** (60 s) | 40 × 10 Hz | 100 | **399** | 2 / 5 / 10 ms | **102 / 158 / 176 ms** (184) | **0** |
| **`large`** (90 s) | 80 × 10 Hz | 250 | **799** | 3 / 8 / 13 ms | **107 / 169 / 188 ms** (205) | **0** |
| stretch (60 s) | 85 × 20 Hz | 600 | 1,696 | 5 / 13 / 17 ms | 117 / 172 / 186 ms (213) | 0 |
| fault injection (30 s) | 40 × 10 Hz, 5% duplicates, 5% reordered, 2% invalid | 100 | 390 | 2 / 5 / 10 ms | 106 / 170 / 240 ms (289) | 0 (all injected faults caught, see below) |

"Errors" counts connect errors, unexpected disconnects, subscribe failures, ack timeouts, non-OK acks, throttled samples, samples dropped locally and samples left unacknowledged at the end. Every run had all of its clients still connected at the end.

| Run | Frames delivered to dashboards | Data out | Per client | Server CPU (one core) | Server memory |
|---|---|---|---|---|---|
| `medium` | 173,710 | 43 MB | 29 frames, 7.2 KB / s | n/a | 210 MB |
| `large` | 644,037 | 157 MB | 28.6 frames, 7.0 KB / s | median 24%, peak 42% | 240 MB peak |
| stretch | 1,051,716 | 302 MB (5 MB / s) | 29.2 frames | median 40%, peak 61% | 233 MB peak |

Server internals at the end of each run (`/api/metrics`): the event-loop lag stayed between 11 and 16 ms mean and 13 to 24 ms p99 (timer resolution is 10 ms). The MongoDB writer queue held 0 to 11 samples, with 0 write failures, and was never backpressured.

## Fault injection

The `--dup 0.05 --reorder 0.05 --invalid 0.02` run sent 564 duplicates, 590 out-of-order samples and 257 malformed samples. The server counted exactly 564 duplicates and 257 invalid samples (`injectionCheck.match: true`). Both kinds are rejected at ingest, before storage or broadcast. Reordered samples that were still new were accepted (0 counted as stale). Every client stayed connected.

## Reading the numbers

- **End to end sits at about 100 ms on purpose.** A load-test sample is stamped with its slot time but produced by a 100 ms timer. The source batches for up to 50 ms and the server sends frames every 50 ms. So about 100 ms passes before the network sees the sample (see `loadtest/README.md`). What matters is that the figure barely moves with load: p99 goes from 176 ms at 100 clients to 186 ms at 600.
- **Fan-out is where the work is.** The stretch run delivered over a million frames (2.1 million samples) to 600 clients in a minute on one core at 40% median. Frames are built once per room and sent to every subscriber, so the cost per client is small.
- **Headroom.** The `large` preset used under half of one core. The ceiling we hit was the source-id limit (`LIMITS.maxSourceId = 99`), not the server. Raising that limit is how to test further.

## Reproduce

    mongod --dbpath ./db                               # or the docker run from the README
    SIM_EMBED=1 npm run dev -w server
    npm run loadtest -- --preset medium
    npm run loadtest -- --preset large
    npm run loadtest -- --sources 85 --hz 20 --clients 600 --seconds 60
    npm run loadtest -- --preset medium --seconds 30 --dup 0.05 --reorder 0.05 --invalid 0.02

Each run prints a JSON summary and writes it to `loadtest/results/` (not committed).
