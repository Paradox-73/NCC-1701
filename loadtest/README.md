# Load test

Starts N sources at H Hz and K dashboard clients against a running server and measures acknowledgement time, end-to-end latency and throughput. It reads the registry, so it works with any set of channels.

    npm run loadtest:smoke
    npm run loadtest -- --sources 40 --hz 10 --clients 100 --seconds 60 --url http://localhost:4000

Options: `--preset smoke|small|medium|large`, `--sources`, `--first-source` (default: above the registry sources, so a running simulator is not replaced), `--hz`, `--clients`, `--seconds`, `--groups warp,shields`, `--watch 1-3`, `--dup`, `--reorder`, `--invalid` (injected share of samples), `--key`, `--user`, `--password` (default `command` / `ncc-command`, a role with `admin`, so metrics can be read). Each run writes JSON to `loadtest/results/` (not committed).
