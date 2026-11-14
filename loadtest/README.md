# Load test

Starts N sources at H Hz and K dashboard clients against a running server and measures acknowledgement time, end-to-end latency and throughput. Its sources are ships (ids above the registry's, so a running simulator is not replaced) sending the 121 ship channels; the dashboard clients log in as Starfleet Command, which may watch sources outside the registry.

    npm run loadtest:smoke
    npm run loadtest -- --sources 40 --hz 10 --clients 100 --seconds 60 --url http://localhost:4000

Options: `--preset smoke|small|medium|large`, `--sources`, `--first-source` (default: above the registry sources, so a running simulator is not replaced), `--hz`, `--clients`, `--seconds`, `--groups warp,shields`, `--watch 1-3`, `--dup`, `--reorder`, `--invalid` (injected share of samples), `--rogue auth|invalid|flood` (runs one phase of the rogue source against `/ingest` instead of a load run, with `--seconds`), `--key`, `--user`, `--password` (default `command` / `ncc-command`, a role with `admin`, so metrics can be read). Each run writes JSON to `loadtest/results/` (only the two named in `docs/PERFORMANCE.md` are committed).

## Smoke run on the starship registry (14 Nov 2026, laptop, no Docker stack)

`npm run loadtest:smoke -- --url http://localhost:4110` against a server on MongoDB 8 with the full simulator running next to it (4 ships at 50, 20, 20 and 20 Hz plus 4 sickbay hubs at 1 Hz, about 114 samples and 20,000 readings a second), so the load test's 5 extra sources came on top. The server shared the machine with several other development servers, so read the latency as an upper bound.

| Measure | Result |
|---|---|
| Load test sources | 5 ships at 10 Hz, 49 samples a second offered, 731 sent, 731 accepted, 0 duplicates, stale, invalid or throttled |
| Readings through the server | about 26,000 a second: 111.8 samples a second received (simulator plus load test) at 121 channels a ship, plus 1,720 values a second from the sickbay hubs |
| Acknowledgement round trip | p50 2 ms, p95 11 ms, p99 19 ms, max 48 ms |
| End to end, source timestamp to dashboard | p50 131 ms, p95 198 ms, p99 224 ms, max 241 ms (5 dashboard clients); the server's own source-to-emit figure was p50 133, p95 204, p99 222 ms |
| Dashboard load | 36.7 frames and 9.0 KB a second per client, 5 of 5 clients connected, 0 connect errors, 0 subscribe failures |
| Server | event-loop lag mean 15.9 ms, p99 30.5 ms (the timer resolution is 10 ms), 237 MB resident, writer queue 18, 0 write failures, never backpressured |
| Errors | 0 ack timeouts, 0 disconnects |

Why 131 ms and not 50 (inferred from the timers in the pipeline, not measured separately): a load test sample is stamped with its slot time but made by a 100 ms timer, the sender batches for up to 50 ms and the server sends frames every 50 ms, so about 100 ms accumulates before the network and the server see the sample.
