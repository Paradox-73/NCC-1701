# Architecture

How a reading gets from a simulated starship to the bridge screen: the system parts, the path one sample takes, the rooms that fan it out, how commands go back to the ship, and what MongoDB stores. The wire contract is in `PROTOCOL.md` and the domain (ships, channels, roles, alert rules) is in `DOMAIN.md`. This file shows how they fit together.

## System

```mermaid
flowchart LR
  subgraph SIM["Simulator (Node, simulator/)"]
    PHY["4 ships: physics.js<br/>121 channels each, 20-50 Hz"]
    CREW["4 sickbay hubs: crew.js<br/>430 crew, 7 vitals each, 1 Hz"]
    SND["Sender: batching, 4 un-acked max,<br/>credit backpressure, resend"]
    PHY --> SND
    CREW --> SND
  end

  subgraph SRV["Server (Node, Express 5 + Socket.IO 4, server/)"]
    ING["/ingest namespace<br/>validate, rate limit, dedup"]
    DET["Anomaly detector<br/>thresholds + rolling z-score + link loss"]
    LIVE["Live state per source"]
    WR["Batched writer<br/>insertMany every 250 ms"]
    BC["Broadcaster<br/>one frame per room every 50 ms"]
    WORLD["Ship world<br/>condition, log, commands"]
    RUN["Scenario runner<br/>six episode scripts"]
    REST["REST API<br/>JWT, zod, rate limits"]
    LNS["/live namespace<br/>JWT, rooms per role"]
    ING --> LIVE --> DET
    ING --> WR
    ING --> BC --> LNS
    DET --> LNS
    RUN --> WORLD --> LNS
    REST --> WORLD
  end

  DB[("MongoDB<br/>telemetry time series<br/>alerts, users, sources, devices")]

  subgraph CLI["Client (React 19 + Vite, client/)"]
    STORE["Live store: one socket per tab,<br/>ref-counted rooms, ring buffers"]
    UI["Bridge + 7 stations<br/>uPlot charts, canvas, three.js"]
    STORE --> UI
  end

  SND -- "telemetry:batch<br/>(MessagePack)" --> ING
  ING -- "ack + credit" --> SND
  WORLD -- "sim:command" --> ING
  WR --> DB
  REST -- "history, alerts" --> DB
  LNS -- "telemetry:frame, overview,<br/>alert, log, scenario, fx" --> STORE
  UI -- "login, history,<br/>commands" --> REST
```

| Part | Where | Job |
|---|---|---|
| Registry | `shared/registry.js` | The whole domain in one file: 8 sources, channel lists, groups, roles, alert rules, stardate. Nothing else names a channel. |
| Wire format | `shared/schema.js` | Packs a sample as integers `[seq, ts, v0, v1, ...]`, checks ranges, holds the limits and event names. Shared by every package. |
| Simulator | `simulator/` | Ship physics (warp core, shields, hull, decks, sensors, transporter) and crew vitals, sent to `/ingest`. It runs scenario verbs (`hit`, `fault`, `ramp` and others) when the server sends `sim:command`. |
| Server | `server/` | Ingests, deduplicates, detects anomalies, stores, fans out, runs commands and scenarios. One process. |
| Client | `client/` | Cold open, login, the bridge and seven stations. Live data stays in ring buffers outside React state and is drawn on a shared animation frame. |
| Load test | `loadtest/` | N sources and K dashboards, measures acknowledgement and end-to-end latency (`PERFORMANCE.md`). |

## Data flow: ingest → process → store → broadcast

```mermaid
sequenceDiagram
  autonumber
  participant S as Ship (simulator)
  participant I as /ingest
  participant D as Dedup + live state
  participant A as Detector
  participant W as Writer
  participant M as MongoDB
  participant B as Broadcaster
  participant C as Dashboards

  S->>I: telemetry:batch { sourceId, samples[] }
  I->>I: zod envelope + checkPacked per sample<br/>(length, ranges, seq ≥ 1, ts not in future)
  I->>I: token bucket per source<br/>(over limit → throttled)
  I->>D: seq window: duplicate? stale? restart?
  D->>A: new samples, in seq order
  A-->>C: alert (to alerts:{group} rooms)
  I->>W: queue every storeEvery-th sample
  I->>B: queue for rooms src:{id}:{group}
  I-->>S: ack { accepted, duplicates, stale, invalid, throttled, credit }
  loop every 250 ms or 2,000 samples
    W->>M: insertMany({ ordered: false })
  end
  loop every 50 ms
    B->>C: telemetry:frame per non-empty room
  end
  loop every 200 ms
    B->>C: overview (volatile): one row per ship
  end
```

1. **Ingest.** Each source keeps one Socket.IO connection, authenticated with its id and the device key, and sends batches of packed integer samples in MessagePack.
2. **Validate.** The envelope is checked with zod and every sample with `checkPacked`. Bad samples are counted as `invalid` and dropped. Nothing malformed gets past this step.
3. **Rate limit.** A token bucket per source drops whatever is over the limit (`throttled`). It also drops samples that would push the write queue past twice its high-water mark.
4. **Deduplicate and order.** Each source has its highest `seq` plus a bitset over the reorder window. A `seq` already seen is a duplicate, and one older than the window is stale. Out-of-order samples inside the window are still accepted. A source that restarts (old `seq`, much newer `ts`) gets its window reset.
5. **Process.** The live state is updated, and the detector runs threshold rules, a rolling z-score (|z| > 4 for 0.5 s after a 30 s warm-up) and link loss (1.5 s of silence). Alerts go straight out. A critical alert in hull, shields, life support, warp or crew raises the ship to yellow alert.
6. **Store.** The writer queues every `storeEvery`-th sample (ships store less often than they stream) and flushes with `insertMany({ ordered: false })`. Above the high-water mark the ack carries `credit: 0`, and the sender pauses: backpressure reaches all the way back to the source.
7. **Broadcast.** Every 50 ms the broadcaster builds one `telemetry:frame` per non-empty room, with only that group's channels. Socket.IO sends it once to each subscriber in the room.
8. **Draw.** The client store appends frames to a ring buffer per source and group. Charts and gauges read the rings on a shared `requestAnimationFrame` loop, so a 50 Hz stream never re-renders React 50 times a second.

### Joining late without gaps or duplicates

```mermaid
sequenceDiagram
  participant C as Client store
  participant L as /live
  participant R as REST /api/telemetry
  C->>L: subscribe { sourceIds, groups }
  L-->>C: frames start arriving (buffered)
  C->>R: GET history from..to
  R-->>C: { samples, lastSeq } (includes samples not yet written)
  C->>C: drop buffered seq ≤ lastSeq, append the rest
  Note over C: after a reconnect: fetch the gap, Ring.merge by seq
```

## Rooms: who receives what

```mermaid
flowchart TB
  F["telemetry:frame<br/>sourceId 1, group shields"] --> R1["room src:1:shields"]
  O["overview, 5 Hz"] --> R2["room overview"]
  AL["alert in group bio-d05"] --> R3["room alerts:bio-d05"]
  EV["condition, log, scenario, fx"] --> R4["room ship:1"]
  MET["metrics, 1 Hz"] --> R5["room admin"]

  R1 --> CAP["Captain"]
  R1 --> ENG["Chief engineer"]
  R2 --> CAP & ENG & CMO["Chief medical officer"] & SFC["Starfleet Command"]
  R3 --> CAP & CMO
  R4 --> CAP & ENG & CMO
  R5 --> SFC
```

On connect, the server puts a dashboard into `overview`, the `alerts:<group>` rooms of its role, `ship:<id>` for each ship of its role, and `admin` if the role has it. `subscribe` joins `src:<id>:<group>` rooms, but only for groups and ships the role may see. The rest come back as `denied`, so access control happens before fan-out and not in the browser. The engineer never receives crew biosigns, and the medical officer never receives the warp core. The REST history endpoint applies the same rule (403).

## Commands and scenarios: the way back to the ship

```mermaid
sequenceDiagram
  participant U as Captain (browser)
  participant API as POST /api/ships/1/command
  participant W as Ship world
  participant S as Simulator (ship 1)
  participant L as /live ship:1

  U->>API: { type: "tactical.shields", up: true }
  API->>API: JWT, role may send it, zod payload, rate limit
  API->>W: execute
  W->>S: sim:command over its /ingest socket
  W->>L: command:ack + log "Shields up, aye"
  API-->>U: { ok, at, text }
  S-->>L: shield channels change in the next frames
```

The scenario runner (`server/src/ships/runner.js`) plays one of six episode scripts from `shared/scenarios/` through the same path. Each step can log a line, set the condition, send simulator verbs (`hit`, `ramp`, `fault`, `crew`) or wait for a crew command with a timeout. The client sees only the resulting `log`, `scenario`, `fx` events and the telemetry itself.

## Database schema

```mermaid
erDiagram
  SOURCES ||--o{ TELEMETRY : "sourceId (metaField)"
  SOURCES ||--o{ ALERTS : "sourceId"
  SOURCES ||--|| DEVICES : "sourceId"
  USERS ||--o{ ALERTS : "ack.by = username"

  SOURCES {
    number sourceId UK
    string name
    string code
  }
  TELEMETRY {
    date ts "timeField"
    number sourceId "metaField"
    number channel_values "one field per stored channel"
  }
  ALERTS {
    number sourceId
    number ts
    string type "rule name, zscore or link-loss"
    string group "channel group or null"
    string channel
    number value
    number threshold
    string severity "info, warn, critical"
    string message
    object ack "by, at, reason"
    object resolved "at, reason"
    date createdAt "TTL index"
  }
  DEVICES {
    number sourceId UK
    number lastSeq "dedup survives a restart"
    date lastSeenAt
  }
  USERS {
    string username UK
    string passwordHash "bcrypt"
    string role "captain, chief_engineer, ..."
  }
```

| Collection | Kind | Retention | Indexes |
|---|---|---|---|
| `telemetry` | MongoDB time series (`timeField: ts`, `metaField: sourceId`, granularity seconds). Falls back to a plain collection with a TTL index where time series are refused. | `TELEMETRY_TTL_SEC`, 24 h locally and 2 h on the free hosted tier | time series bucketing by source and time |
| `alerts` | plain | `ALERTS_TTL_SEC` from `createdAt`, 7 days | `{ sourceId: 1, ts: -1 }`, TTL on `createdAt` |
| `devices` | plain | kept | unique `sourceId` |
| `sources`, `users` | plain, seeded on start | kept | unique `sourceId`, unique `username` |

History queries (`GET /api/telemetry`) read the time series for one source and window. Above `maxPoints` they downsample with `$bucketAuto`, keeping the newest sample in each bucket. They also merge in samples that were accepted and broadcast but not yet flushed, so a chart never shows a hole at the right edge.

## Deployment

```mermaid
flowchart LR
  B["Browser"] -- "HTTPS: static app" --> V["Vercel<br/>client/dist"]
  B -- "HTTPS + WSS<br/>VITE_API_URL" --> R["Render free web service<br/>server + embedded simulator<br/>(SIM_EMBED=1, SIM_HZ=5)"]
  R -- "MONGO_URI" --> A[("MongoDB Atlas M0")]
```

Locally `docker compose up --build` runs four containers (mongo, server, client on nginx, simulator). In the hosted setup the simulator runs inside the server process, because Render has no free background worker. Its rate is lowered to fit the free CPU share (`render.yaml`).
