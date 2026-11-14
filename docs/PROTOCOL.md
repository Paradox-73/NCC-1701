# Telemetry engine: protocol and layout

This file is the contract between the parts of the repo. The wire format lives in code in `shared/schema.js`. The domain content (sources, groups, channels, roles, alert rules) lives in one file, `shared/registry.js`.

## Layout

| Folder | What it is | Run with |
|---|---|---|
| `shared/` | `registry.js` (domain content), `schema.js` (pack, unpack, check, limits, event names) and `scenarios/` (the six episode scripts) | imported as `@ncc/shared/schema.js` |
| `server/` | Node.js, Express 5, Socket.IO 4, Mongoose 8 | `npm run dev -w server` (port 4000) |
| `client/` | Vite and React shell, live store, Chart, VirtualList | `npm run dev -w client` (port 5173) |
| `simulator/` | four ships, four sickbay hubs and the physics behind them, sending to `/ingest` | `npm start -w simulator` |
| `loadtest/` | N sources and K dashboard clients, measures latency and throughput | `npm run loadtest:smoke` |

`docker compose up --build` starts MongoDB, server, client and simulator. `npm test` runs the shared, server and client tests; the server tests need MongoDB on `127.0.0.1:27017`.

## Swapping the domain

Replace `shared/registry.js` and keep its export names: `SOURCES`, `KINDS`, `GROUP_DEFS`, `CHANNELS`, `ROLES`, `RULES`, `stardate`. Nothing else names a channel, group or role. Two other files hold placeholder content: the seed users in `server/src/seed.js` (one per role) and the demo wiring on `client/src/pages/Live.jsx` (reads the registry only). The tests in `server/test/` and `shared/test/` name channels of this registry (`chamberTemp`, `o2_01`, `hr_207`) and fail loudly when a swapped registry drops one; they are the list of what to update, and the scenarios in `shared/scenarios/` name channels too.

Fields: a source has `id`, `kind` (`ship` or `crew`), `name`, `code`, `hz` (the rate the simulator samples every channel at) and `hostedHz`; a crew source also has `ship`. `KINDS[kind]` has `channels`, `groups` and `storeEvery`. A channel has `key`, `label`, `unit`, `min`, `max`, `scale`, `nominal`, `group`. A group has `key`, `label`, `kind`. A role has `label`, `ships`, `groups`, `commands`, `canAck`, `admin`. `RULES.thresholds` are `{ type, channel, dir: 'high' | 'low', warn, critical }`; `RULES.zChannels` are also watched by the rolling z-score detector.

## Wire format

A sample is a flat array of integers `[seq, ts, v0, v1, ...]`. `seq` is a per-source counter from 1, `ts` is milliseconds since the Unix epoch set by the source, `vN` is the channel value times its `scale`, rounded, in the channel order of the source's kind (`channelsOf(sourceId)`). All Socket.IO servers and clients use `socket.io-msgpack-parser`.

## Namespaces

### `/ingest` (sources to server)

- Handshake `auth: { sourceId, key }`. A wrong key or a `sourceId` outside 1 to `LIMITS.maxSourceId` is refused; refused handshakes are counted against the claimed id (see Ingest alerts). One live connection per source; a new one replaces the old one. The default namespace `/` refuses every connection.
- The source emits `telemetry:batch` with `{ sourceId, samples }` (at most `LIMITS.maxSamplesPerBatch`) and an ack callback. Ack: `{ ok, accepted, duplicates, stale, invalid, throttled, credit }`.
- The source keeps at most 4 batches un-acked and pauses when `credit` is 0 (backpressure). When `throttled > 0` the server kept the first samples and dropped the last `throttled`; the sender puts them back at the front and resends after 100 ms. A batch refused whole by the rate limit is resent whole. A batch refused as invalid is not resent.
- The server may emit `sim:command` with `{ type, args }`. The simulator looks `type` up in `simulator/src/commands.js`; the ship command route and the scenario runner use it (see Ship routes and Scenarios). `mute` (`args.seconds`) is handled by the simulator loop: it stops sending, then sends the backlog scrambled and partly duplicated.

### Server pipeline for each batch

1. Validate the envelope (zod) and every sample with `checkPacked`: length, integer channels inside their ranges, safe-integer `seq` of at least 1, `ts` no more than `LIMITS.maxFutureMs` ahead of the server clock. Invalid samples are counted and dropped.
2. Token bucket per source (`LIMITS.sourceRatePerSec`, `LIMITS.sourceBurst`). Samples over the limit, and samples that would grow the write queue past twice the high-water mark, are counted as `throttled` and dropped.
3. Duplicates and order per source: the highest `seq` seen plus a bitset of the last `LIMITS.reorderWindow` numbers. Already seen is a duplicate; older than the window is stale. A stale `seq` whose `ts` is more than 2 s newer than anything accepted means the source restarted: its window and live state reset.
4. Update live state (only for increasing `seq`) and run the detector.
5. Queue for MongoDB: a writer flushes every 250 ms or 2,000 samples with `insertMany({ ordered: false })`. Above `WRITER_HIGH_WATER` acks carry `credit: 0`.
6. Queue for broadcast.

### `/live` (server to dashboards)

- Handshake `auth: { token }` with the JWT from `POST /api/auth/login`.
- On connect the server joins the socket to `overview:<role>`, `alerts` and `alerts:<group>` for each group of its role, `ship:<id>` for each ship of its role, plus `admin` when the role has `admin`.
- `subscribe { sourceIds, groups? }` acks `{ ok, rooms, denied, deniedSources }`. Rooms are `src:<id>:<group>`. Without `groups` the role's groups are used. Groups the role may not see are listed in `denied`, sources it may not see in `deniedSources`; neither is joined. A group of the other kind (`bio-d07` on a ship) is skipped silently. `unsubscribe { sourceIds, groups? }` leaves them.
- Every `FRAME_MS` (50) the server emits one `telemetry:frame` per non-empty room: `{ sourceId, group, keys, samples }` with `[seq, ts, ...values for keys]`, in `seq` order.
- Every 200 ms the server emits `overview` (volatile, dropped for slow clients): `{ ts, sources: [[sourceId, flags, condition, warp*100, weakestShield*10, posX*10, posY*10, heading*10]], rx }`, one row per ship; see Ship rooms and events. `rx` is readings accepted per second.
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
| `GET /api/sources` | the registry sources the role sees, with `kind`, `ship`, `online` |
| `GET /api/telemetry` | history, see above |
| `GET /api/alerts?sourceId=&since=&unacked=&limit=` | alert history for the caller's groups and ships |
| `GET /api/ships`, `GET /api/ships/:id/state`, `POST /api/ships/:id/command`, `GET /api/scenarios` | ship state, shipboard commands and scenarios, see Ship routes |
| `POST /api/alerts/:id/ack` | acknowledge (role with `canAck`, alert in its groups) |
| `POST /api/alerts/ack-all` | acknowledge every open alert the caller's role may see and ack; returns `{ acked }` |
| `GET /api/metrics` | server counters (role with `admin`) |
| `POST /api/sim/:sourceId/command` | `{ type, args }` relayed as `sim:command` (role with `admin`); `clear` also resets the detector |

Every route validates input with zod. `express-rate-limit` allows 600 requests per minute per IP, and 10 failed logins per minute. Client errors keep their 4xx status.

## Anomaly detection

- Threshold rules from `RULES.thresholds`: one alert opens per source and rule, and a rise from warn to critical sends one more.
- Rolling z-score on `RULES.zChannels`: alert at |z| over 4 held for 0.5 s, after a 30 s warm-up. Window and warm-up count sample time, so a 5 Hz source and a 50 Hz source behave the same.
- Each source kind runs only its own rules: a ship's thresholds never run on a sickbay sample, and the per-crew rules (`hr_NNN` and so on, 3,010 of them) only on crew hubs. A two-sided limit is two rules on one channel with different `type` names (`fever` and `hypothermia`). An alert's `group` is its channel's group, so per-crew alerts go only to `alerts:bio-dNN`.
- `Detector.settle(sourceId, ms)`: for `ms` the z-score statistics follow the values instead of flagging them. The server calls it when a helm command really changes the warp or impulse level (a repeat of the current order does not), and when a scenario snaps or releases the operating point.
- Link loss: no samples for 1.5 s. It stays silent until the detector has run 5 s and the source has sent for 5 s.
- An alert stays open until its condition has been false for 3 s. When the server starts, every unacknowledged warn or critical alert is closed with `ack.by: "system"` and the reason `server restarted`, because the detector keeps its open conditions in memory.

## MongoDB collections

| Collection | Notes |
|---|---|
| `telemetry` | time series, `timeField: ts`, `metaField: sourceId`; plain collection with a TTL index when the server refuses time series (`TELEMETRY_TIMESERIES=0` forces it); expires after `TELEMETRY_TTL_SEC` (24 h) |
| `alerts` | expire after `ALERTS_TTL_SEC` (7 days) counted from `createdAt` |
| `sources`, `users`, `devices` | `devices` holds the last `seq` per source so dedup survives a restart |

## Source kinds, ships and roles

There are two kinds of source. A **ship** source streams the 121 channels of `KINDS.ship`; a **crew** source (the sickbay hub of one ship) streams four vitals for each of 430 crew, 1,720 values once a second. `kindOf(sourceId)` in `shared/schema.js` gives the kind; an id outside the registry counts as a ship, so load-test sources need nothing registered. Registry sources: ships 1 Enterprise (50 Hz), 2 Constellation, 3 Exeter, 4 Intrepid (20 Hz); crew hubs 11 to 14, the hub of ship N is N + 10. `packSample`, `unpackSample` and `checkPacked` take the source id as their last argument; `channelsOf(id)`, `channelIndex(id)`, `sampleLen(id)` and `groupsOf(id)` give the layout of a source.

Groups: the ship kind has `helm`, `warp`, `impulse`, `shields`, `weapons`, `power`, `hull`, `lifesupport`, `gravity`, `sensors`, `transporter`, `comms`, `crewsummary`; the crew kind has `bio-d01` to `bio-d12`, one per deck. A client may only subscribe to a group of the source's kind: `src:1:bio-d07` and `src:11:warp` are never joined.

A role in the registry has `ships` (the source ids it may see), `groups`, `commands` (command types it may send; `family.*` matches a family), `canAck` and `admin`. The server refuses what the role does not list: subscriptions (`deniedSources`), history, alert history and acknowledgement, ship state and commands. Biosigns (`bio-dNN`) belong to the captain and the chief medical officer only; Starfleet Command sees ships 1 to 4 and `crewsummary` counts, never a person's vitals.

| Role (`role` in the JWT) | Demo login | Ships | Commands |
|---|---|---|---|
| `captain` | `captain` / `ncc-captain` | 1, 11 | every shipboard command, `scenario.*` |
| `chief_engineer` | `engineer` / `ncc-engineer` | 1 | `engineering.*`, `transporter.energize` |
| `chief_medical_officer` | `medical` / `ncc-medical` | 1, 11 | `medical.*` |
| `science_officer` | `science` / `ncc-science` | 1 | `science.scan` |
| `communications_officer` | `comms` / `ncc-comms` | 1 | `comms.*` |
| `starfleet_command` | `command` / `ncc-command` | 1 to 4 | `scenario.*`, `sim.fault`, and `admin` (metrics) |

Stardate: `stardate(ts) = 1000 + (ts - Date.UTC(2026, 0, 1)) / 8_640_000`, exported from `shared/schema.js` (ten units a day, about 4170 in mid-November 2026). A time warp adds an offset, see the `fx` event below.

## Ship rooms and events (`/live`)

On connect a socket joins `ship:<id>` for each ship its role sees. These events carry no telemetry, so a client needs no subscription for them. Every payload is plain JSON (MessagePack on the wire).

| Event | Payload | When |
|---|---|---|
| `condition` | `{ shipId, level: 'normal' \| 'yellow' \| 'red', by, ts }` | the condition changed: the captain, a scenario, or the alert system (`by: 'alert system'`) |
| `log` | `{ shipId, ts, stardate, text, sound?, by }` | a captain's-log line: a command acknowledgement, a scenario line (`sound` is a cue name such as `chirp`, `alarm`, `warp`, `boom`, `klaxon`), an alert-system line |
| `command:ack` | `{ shipId, type, args, by, role, ok, at, text }` | a command was accepted; `by` is the user, or `scenario` when the runner issued it |
| `scenario` | `{ state, id, title, shipIds, t, step, steps, duration, awaiting, ts }` | scenario progress: on every step, every second, on a resolution. `state` is `running`, `awaiting`, `ended` or `stopped`; `awaiting` is `null` or `{ type, ...payload, shipId, timeout, secondsLeft }`, the command the scenario waits for |
| `fx` | `{ shipId, ts, name, ...fields }` | a visual cue. `timewarp` has `stardateDelta` (about -29.58: the ship's stardate shifts by that); `viewscreen` has `scene` (`psi-2000`, `planet-closing`, `halkan`); `forecast` has `channel`; `sound` has `sound`; `hit` has `quad` (`fore`, `aft`, `port`, `stbd` or `all`), `amount` and maybe `hull`, sent with every scenario `hit` so the bridges flare the quadrant that took it |

`overview` rows are `[sourceId, flags, condition, warp*100, weakestShield*10, posX*10, posY*10, heading*10]`, one per registry ship of the caller's role that the server has heard from, 5 Hz, volatile. Roles without the `helm` group get 0 in the warp, position and heading columns, and roles without `shields` get 0 in the shield column. `flags`: bit 0 online, bit 1 a warn alert is open, bit 2 a critical alert is open. `condition`: 0 normal, 1 yellow, 2 red. A ship that stopped sending keeps its row with the online bit off and its last values, so the fleet map can show it as lost. Crew hubs have no row.

Alerts about a source go only to roles that list it in `ships`, in addition to the group rule: an engineer never receives an alert about ship 2. Alerts of a source outside the registry (the rogue source 99) and alerts with no group go to everyone.

## Ship condition

Each ship has a condition: `normal`, `yellow` or `red`, kept on the server. The captain orders it (`ship.condition`), a scenario step sets it, and a **critical** alert in `hull`, `shields`, `lifesupport`, `warp` or `crewsummary` raises a ship at `normal` to `yellow` (log line "Yellow alert: ..."). Only the captain or a scenario sets red. Yellow and red raise the shields; red also switches power to COMBAT, and normal back to CRUISE. A simulator that connects (or reconnects) is told the ship's condition again.

## Ship routes

All need `Authorization: Bearer <jwt>`. A role that does not see the ship gets 403.

| Method and path | Purpose |
|---|---|
| `GET /api/ships` | `{ ships: [{ shipId, name, code, condition, online }] }` for the ships the role sees |
| `GET /api/ships/:id/state` | `{ shipId, condition, scenario, log, stardateOffset }`: what a dashboard that joins late needs (`log` is the last 60 lines, `scenario` is the `scenario` event payload or `null`) |
| `POST /api/ships/:id/command` | a shipboard command, see below. Answers `{ ok, at, text }` |
| `GET /api/scenarios` | `{ scenarios: [{ id, title, episode, summary, shows, ships, duration }], status }`; `status` is the running scenario's progress or `null` |

### Commands

Body `{ type, ...payload }`, validated with zod: unknown type, unknown field or a bad value is 400; a role that may not send the type is 403; a user over 10 commands a second (burst 20) is 429; a simulator that is not connected is 409. The server relays the command to the ship's simulator as `sim:command { type, args }`, sends `command:ack` and `log` to `ship:<id>`, and the effect shows up in the telemetry within a sample.

| `type` | Payload | Roles | Effect |
|---|---|---|---|
| `helm.warp` | `{ factor: 0-9 }` | captain | warp order; 0 drops to impulse 20 |
| `helm.impulse` | `{ percent: 0-100 }` | captain | impulse order |
| `helm.heading` | `{ deg: 0-359.9 }` or `{ delta: -90 to 90 }` | captain | heading order, 3 degrees a second |
| `helm.stop` | `{}` | captain | warp 0, impulse 0 |
| `tactical.shields` | `{ up: boolean }` | captain | `shieldsUp` |
| `tactical.phasers` | `{ bank?: 'fore' \| 'aft' }` | captain | fires; 1 s cooldown, 40 % of a bank, heats the coolant |
| `tactical.torpedo` | `{}` | captain | needs a loaded tube |
| `ship.condition` | `{ level: 'normal' \| 'yellow' \| 'red' }` | captain | ship condition |
| `comms.hail` | `{ target: shipId \| 'command' }` | captain, communications officer | `hailing` = 1, one more open channel |
| `comms.close` | `{}` | captain, communications officer | `hailing` = 0 |
| `engineering.allocate` | `{ preset: 'cruise' \| 'combat' \| 'emergency' }` | captain, chief engineer | power allocation |
| `engineering.coldRestart` | `{}` | captain, chief engineer | scenario only |
| `transporter.energize` | `{}` | captain, chief engineer | one transporter cycle (about 4.5 s, 18 MW) |
| `medical.inoculate` | `{ deck?: 1-12 }` | captain, chief medical officer | infected crew recover over 20 s |
| `medical.quarantine` | `{ deck: 1-12 }` | captain, chief medical officer | stops the spread from that deck |
| `science.scan` | `{ mode: 'long' \| 'short' \| 'focus' }` | captain, science officer | `focus` doubles `contactSnr` for 10 s |
| `security.ventGas` | `{ deck: 1-12 }` | captain | scenario only |
| `scenario.start` | `{ id }` | captain, Starfleet Command | starts a scenario; 404 unknown id, 409 when one runs or a ship of it is offline |
| `scenario.stop` | `{}` | captain, Starfleet Command | stops it and restores normal running; 409 when none runs |
| `sim.fault` | `{ sourceId?, fault: 'mute' \| 'storm' \| 'spike' \| 'clear', seconds?: 1-60 }` | Starfleet Command | `:id` (or `sourceId`) gets a stream fault; `mute` silences the source and then resends the backlog scrambled, `storm` duplicates, delays and corrupts samples, `spike` is a 3 s outlier on `reactionRate`, `clear` removes faults |

A scenario-only command (`engineering.coldRestart`, `security.ventGas`) is refused with 409 unless a running scenario waits for exactly that command.

The old admin route `POST /api/sim/:sourceId/command` (`{ type, args }`, role with `admin`) still exists for the single-channel `fault` command and `clear`.

## Scenarios

Six episode scripts in `shared/scenarios/` (listed in `index.js`): `balance-of-terror`, `the-naked-time`, `the-doomsday-machine`, `mirror-mirror`, `the-trouble-with-tribbles`, `space-seed`. The runner (`server/src/ships/runner.js`) plays one at a time in real time. A script is `{ id, title, episode, summary, shows, ships, duration, steps }`; a step is `{ t, ...verbs }` with `t` in seconds. Every verb takes `source` (a ship id) to address a ship other than the scenario's first.

| Verb | Value | What the simulator does |
|---|---|---|
| `log` | text (and `sound`) | a log line to the ship room |
| `cmd` | a command as in the table above | runs it as if from the bridge; goes through the same log, ack and relay |
| `set` | `{ ch, to }` or a list | holds a channel at a value |
| `ramp` | `{ ch, to, over }` or a list | moves a channel there from where it is, over seconds, then holds |
| `noise` | `{ ch, sigma }` | adds correlated noise (about 1 s long) to a channel; `sigma` 0 removes it |
| `hit` | `{ quad: 'fore' \| 'aft' \| 'port' \| 'stbd' \| 'all', amount, hull? }` | takes `amount` from a shield quadrant and loads the generator; with shields down it damages the hull; `hull` is extra damage that gets through |
| `contact` | `{ n, bearing, range }` | tracked contacts and the nearest one's bearing and range (km); `n: 0` clears |
| `crew` | `{ infect: [ids] }`, `{ spread: { every, max } }` or `false`, `{ recover: ids, over }`, `{ shift: { ids, nr, hr, ... } }`, `{ set: { ids, hr, rr, bt, nr, infected? } }`, `{ sedate: deck }`, `{ quarantine: deck }` | acts on the crew model; `ids` is a list, `{ from, to }`, `{ deck }` or `'all'` |
| `fault` | `{ fault: 'mute' \| 'storm' \| 'lost' \| 'spike', seconds }` | a stream fault on the source; `lost` stops it for good until the scenario ends, and it restarts 30 s later |
| `rogue` | `{ phase: 'auth' \| 'invalid' \| 'flood', seconds }` | a rogue source attacks `/ingest`, see Ingest alerts |
| `snap` | `{ warp, impulse, heading }` | sets the operating point at once, and tells the detector to follow it |
| `release` | `{ ch: [keys], over }` | channels drift back to the model |
| `condition` | `'normal' \| 'yellow' \| 'red'` | the ship's condition |
| `fx` | `{ name, ... }` | an `fx` event |
| `await` | `{ type, ...match }`, with `timeout` seconds (and `issue`) | the clock stops until the named command arrives from a dashboard (every field in `match` must equal), or `timeout` seconds pass and the runner sends the command itself |
| `end` | `true` | finishes the scenario |

When a scenario ends or is stopped, the simulator releases every override over 10 s and returns the state to calm running: the ship's own cruise warp, hull and shields full, condition normal, no contacts, the crew healthy. The detector is told to relearn its statistics for 30 s (`Detector.settle`) so the move back is not read as an anomaly. At start and at end the server also closes and acknowledges, as `system`, the open warn and critical alerts of the scenario's ships, so each run starts from a clean list, and at end it sends a second `timewarp` fx that undoes any stardate offset the scenario left.

### Measured lengths and what each shows

Unattended means every `await` waits out its timeout; with a presenter acting a second or two after each prompt the scenario is shorter by most of the waits. "Offline" is the virtual-clock run in `server/test/scenarios.test.js`; "live" is a real server on :4110 with the real simulator, driven over REST and Socket.IO.

| Scenario | Unattended, offline | Live | Shows |
|---|---|---|---|
| Balance of Terror | 108 s | 107.3 s unattended, 94.0 s with a presenter | the statistical detector finding a ghost no limit can see; red alert; shield hits |
| The Naked Time | 110 s | 101.7 s with a presenter | 430-crew stream and privacy by role; orbit decay; cold restart; time warp |
| The Doomsday Machine | 114 s | 113.3 s unattended | ships 1 and 2; link loss; the Constellation lost and its history |
| Mirror, Mirror | 75 s | 65.4 s with a presenter | storm on the link: duplicate, late and malformed samples |
| The Trouble with Tribbles | 89 s | 88.2 s unattended | life support deck by deck; cascading alerts; growth forecast |
| Space Seed | 97 s | 96.3 s unattended | wrong key, forged data, flood; role-checked commands |

## Ingest alerts

The server raises three more alerts from its own counters, per source, over a 2 s window, through the same open, escalate and debounce rules as channel alerts (`server/src/ingest/watch.js`). They have no channel group, so every role sees them.

| `type` | Condition | Severity |
|---|---|---|
| `ingest-auth` | 3 or more refused `/ingest` handshakes (counted against the source id the caller claimed) | warn |
| `ingest-invalid` | more than 20 invalid samples a second | warn |
| `ingest-flood` | more than 200 throttled samples a second | critical |

The Space Seed rogue source (`simulator/src/rogue.js`, also `npm start -w loadtest -- --rogue auth`): `auth` makes five handshakes with wrong keys claiming to be source 1, `invalid` and `flood` connect as source 99 (on no roster, so no ship's connection is replaced) with the real key and send out-of-range readings (`o2_01` = -5) at about 2,000 a second, or valid-looking samples at about 5,000 a second.

## Simulator

`npm start -w simulator -- --url http://localhost:4000 --key <DEVICE_KEY> [--profile hosted] [--hz N] [--sources N]` starts one source per registry entry: four ships (`simulator/src/physics.js`) and four sickbay hubs, which stream the vitals of the ship's crew model (`simulator/src/crew.js`). `--profile hosted` (or `SIM_PROFILE=hosted`) uses the lower `hostedHz` rates and drops the hubs of ships 2 to 4. The crew hub stores one sample in `CREW_STORE_EVERY` (default 1; set 5 on a hosted tier) and always streams every sample live. `sim:command` types the simulator knows are the bridge commands above, the `scn.*` verbs (`scn.set`, `scn.ramp`, `scn.noise`, `scn.hit`, `scn.contact`, `scn.crew`, `scn.snap`, `scn.release`, `scn.fault`, `scn.rogue`), `fault`, `clear`, `fault.spike`, `fault.storm` and `mute`.

## Environment

`server/.env` (see `.env.example` at the root): `MONGO_URI` (use `127.0.0.1`, because `localhost` can resolve to an IPv6 address MongoDB is not listening on), `PORT`, `JWT_SECRET`, `DEVICE_KEY`, `CORS_ORIGIN`, `SIM_EMBED` (also `SIM_PROFILE=hosted` for the simulator), `CREW_STORE_EVERY` (store one crew-hub sample in N, default 1). With `NODE_ENV=production` the server refuses to start while a secret is one of the public example values.
