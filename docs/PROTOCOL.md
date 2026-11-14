# Telemetry engine: protocol and layout

This file is the contract between the parts of the repo. The wire format lives in code in `shared/schema.js`. The domain content (sources, groups, channels, roles, alert rules) lives in one file, `shared/registry.js`.

## Layout

| Folder | What it is | Run with |
|---|---|---|
| `shared/` | `registry.js` (domain content) and `schema.js` (pack, unpack, check, limits, event names) | imported as `@ncc/shared/schema.js` |
| `server/` | Node.js, Express 5, Socket.IO 4, Mongoose 8 | `npm run dev -w server` (port 4000) |
| `client/` | Vite and React shell, live store, Chart, VirtualList | `npm run dev -w client` (port 5173) |
| `simulator/` | sources that send telemetry to `/ingest` | `npm start -w simulator` |
| `loadtest/` | N sources and K dashboard clients, measures latency and throughput | `npm run loadtest:smoke` |

`docker compose up --build` starts MongoDB, server, client and simulator. `npm test` runs the shared, server and client tests; the server tests need MongoDB on `127.0.0.1:27017`.

## Swapping the domain

Replace `shared/registry.js` and keep its export names: `SOURCES`, `GROUP_DEFS`, `CHANNELS`, `ROLES`, `RULES`. Nothing else names a channel, group or role. Two other files hold placeholder content: the seed users in `server/src/seed.js` (one per role) and the demo wiring on `client/src/pages/Live.jsx` (reads the registry only). The tests in `server/test/` use placeholder channel names such as `plasmaTemp`; they fail loudly when a swapped registry drops a channel, and are the list of what to update.

Fields: a source has `id`, `name`, `code`, `hz` (the rate the simulator samples every channel at). A channel has `key`, `label`, `unit`, `min`, `max`, `scale`, `nominal`, `group`. A role has `label`, `groups`, `canAck`, `admin`. `RULES.thresholds` are `{ type, channel, dir: 'high' | 'low', warn, critical }`; `RULES.zChannels` are also watched by the rolling z-score detector.

## Wire format

A sample is a flat array of integers `[seq, ts, v0, v1, ...]`. `seq` is a per-source counter from 1, `ts` is milliseconds since the Unix epoch set by the source, `vN` is the channel value times its `scale`, rounded, in `CHANNELS` order. All Socket.IO servers and clients use `socket.io-msgpack-parser`.

## Namespaces

### `/ingest` (sources to server)

- Handshake `auth: { sourceId, key }`. A wrong key or a `sourceId` outside 1 to `LIMITS.maxSourceId` is refused. One live connection per source; a new one replaces the old one. The default namespace `/` refuses every connection.
- The source emits `telemetry:batch` with `{ sourceId, samples }` (at most `LIMITS.maxSamplesPerBatch`) and an ack callback. Ack: `{ ok, accepted, duplicates, stale, invalid, throttled, credit }`.
- The source keeps at most 4 batches un-acked and pauses when `credit` is 0 (backpressure). When `throttled > 0` the server kept the first samples and dropped the last `throttled`; the sender puts them back at the front and resends after 100 ms. A batch refused whole by the rate limit is resent whole. A batch refused as invalid is not resent.
- The server may emit `sim:command` with `{ type, args }`. The simulator looks `type` up in `simulator/src/commands.js`; a scenario script adds commands there. `mute` (`args.seconds`) is handled by the simulator loop: it stops sending, then sends the backlog scrambled and partly duplicated.

### Server pipeline for each batch

1. Validate the envelope (zod) and every sample with `checkPacked`: length, integer channels inside their ranges, safe-integer `seq` of at least 1, `ts` no more than `LIMITS.maxFutureMs` ahead of the server clock. Invalid samples are counted and dropped.
2. Token bucket per source (`LIMITS.sourceRatePerSec`, `LIMITS.sourceBurst`). Samples over the limit, and samples that would grow the write queue past twice the high-water mark, are counted as `throttled` and dropped.
3. Duplicates and order per source: the highest `seq` seen plus a bitset of the last `LIMITS.reorderWindow` numbers. Already seen is a duplicate; older than the window is stale. A stale `seq` whose `ts` is more than 2 s newer than anything accepted means the source restarted: its window and live state reset.
4. Update live state (only for increasing `seq`) and run the detector.
5. Queue for MongoDB: a writer flushes every 250 ms or 2,000 samples with `insertMany({ ordered: false })`. Above `WRITER_HIGH_WATER` acks carry `credit: 0`.
6. Queue for broadcast.

### `/live` (server to dashboards)

- Handshake `auth: { token }` with the JWT from `POST /api/auth/login`.
- On connect the server joins the socket to `overview`, `alerts` and `alerts:<group>` for each group of its role, plus `admin` when the role has `admin`.
- `subscribe { sourceIds, groups? }` acks `{ ok, rooms, denied }`. Rooms are `src:<id>:<group>`. Without `groups` the role's groups are used. Groups the role may not see are listed in `denied` and not joined. `unsubscribe { sourceIds, groups? }` leaves them.
- Every `FRAME_MS` (50) the server emits one `telemetry:frame` per non-empty room: `{ sourceId, group, keys, samples }` with `[seq, ts, ...values for keys]`, in `seq` order.
- Every 200 ms the server emits `overview` (volatile, dropped for slow clients): `{ ts, sources: [[sourceId, flags]], rx }`. Flags: bit 0 online, bit 1 warn alert open, bit 2 critical open. `rx` is readings accepted per second.
- `alert` goes to `alerts:<group>` of the alert's channel group, or to `alerts` when the alert has no group (link loss). `alert:ack` follows the same rooms. `metrics` goes to `admin` once a second.
- `alert:ack { id }` acknowledges. It needs a role with `canAck` and an alert in the role's groups (or without a group).

## History and live without duplicates

1. Subscribe first and buffer incoming frames.
2. `GET /api/telemetry?sourceId=1&from=<ms>&to=<ms>&maxPoints=2000` returns `{ sourceId, keys, samples, lastSeq, downsampled }`. `from` and `to` are at most one hour apart. The result includes samples accepted and broadcast but not yet written. Above `maxPoints` the server downsamples with `$bucketAuto`, keeping the newest sample of each bucket. Only channels of the caller's role are returned; a request for channels outside it gets 403.
3. Drop buffered samples with `seq <= lastSeq`, append the rest, then append each live sample above the last one drawn. After a reconnect, fetch the gap and merge by `seq` (`Ring.merge` in `client/src/lib/ring.js`).

## REST API (JSON, `Authorization: Bearer <jwt>` except login and health)

| Method and path | Purpose |
|---|---|
| `POST /api/auth/login` | `{ username, password }` gives `{ token, user }`; `user` carries the role's registry entry |
| `GET /api/auth/me` | current user |
| `GET /api/health` | liveness and MongoDB state |
| `GET /api/sources` | registry sources with `online` |
| `GET /api/telemetry` | history, see above |
| `GET /api/alerts?sourceId=&since=&unacked=&limit=` | alert history for the caller's groups |
| `POST /api/alerts/:id/ack` | acknowledge (role with `canAck`, alert in its groups) |
| `GET /api/metrics` | server counters (role with `admin`) |
| `POST /api/sim/:sourceId/command` | `{ type, args }` relayed as `sim:command` (role with `admin`); `clear` also resets the detector |

Every route validates input with zod. `express-rate-limit` allows 600 requests per minute per IP, and 10 failed logins per minute. Client errors keep their 4xx status.

## Anomaly detection

- Threshold rules from `RULES.thresholds`: one alert opens per source and rule, and a rise from warn to critical sends one more.
- Rolling z-score on `RULES.zChannels`: alert at |z| over 4 held for 0.5 s, after a 30 s warm-up. Window and warm-up count sample time, so a 5 Hz source and a 50 Hz source behave the same.
- Link loss: no samples for 1.5 s. It stays silent until the detector has run 5 s and the source has sent for 5 s.
- An alert stays open until its condition has been false for 3 s. When the server starts, every unacknowledged warn or critical alert is closed with `ack.by: "system"` and the reason `server restarted`, because the detector keeps its open conditions in memory.

## MongoDB collections

| Collection | Notes |
|---|---|
| `telemetry` | time series, `timeField: ts`, `metaField: sourceId`; plain collection with a TTL index when the server refuses time series (`TELEMETRY_TIMESERIES=0` forces it); expires after `TELEMETRY_TTL_SEC` (24 h) |
| `alerts` | expire after `ALERTS_TTL_SEC` (7 days) counted from `createdAt` |
| `sources`, `users`, `devices` | `devices` holds the last `seq` per source so dedup survives a restart |

## Environment

`server/.env` (see `.env.example` at the root): `MONGO_URI` (use `127.0.0.1`, because `localhost` can resolve to an IPv6 address MongoDB is not listening on), `PORT`, `JWT_SECRET`, `DEVICE_KEY`, `CORS_ORIGIN`, `SIM_EMBED`. With `NODE_ENV=production` the server refuses to start while a secret is one of the public example values.
