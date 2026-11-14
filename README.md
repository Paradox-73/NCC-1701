# Subspace

**A real-time telemetry platform you can sit inside**, named for the band Starfleet sends its signals on. Four starships and 430 crew send about 115 samples a second, which is about 20,000 channel values a second. A MERN stack validates, deduplicates, stores and fans them out by role, and they arrive on a recreation of the original-series Enterprise bridge, where every station is a live dashboard.

Built for the MERNify hackathon.

**Links**

- Repository: _add the GitHub URL_
- Demo video: _add the video URL_
- Live app: _add the hosted URL_

**Two units, used everywhere in this project.** A *sample* is one reading of a whole source at one instant: a ship's 121 channels, or a sickbay hub's 1,720 crew values. A *channel value* is one number inside a sample. The app's top bar shows samples per second (`rd/s`, about 115 with the full local simulator). The "about 20,000" headline counts channel values per second: roughly 110 ship samples times 121 channels, plus 4 hub samples times 1,720.

![The bridge during Balance of Terror: warp 6, the scenario strip across the viewscreen, every station live](docs/screenshots/app-bridge.png)

## The problem

Telemetry dashboards are usually one of two things: a pretty demo with fake numbers, or a real pipeline with a dull grid of charts. We wanted both halves done properly:

- **A real pipeline.** Thousands of readings a second from many sources, over flaky links that duplicate, reorder and corrupt data. It has to be validated, stored as a time series, checked for anomalies, and fanned out to many viewers without anyone seeing data they shouldn't.
- **A screen people want to look at.** The captain, the chief engineer and the doctor need different views of the same ship. Alerts have to call for attention without drowning everything else.

A starship is a good test case: one ship carries 121 channels (warp core, shields, hull, twelve decks of life support, sensors, transporter, comms) and 430 people, and every episode is an incident report.

## Run it in 60 seconds

You need Docker (with Compose) and free ports 5173 (the app) and 4000 (the server).

```bash
docker compose up --build
```

1. Open **http://localhost:5173** and press **Engage**: the original-series opening plays with sound and the login comes in on the theme's beat drop (Esc skips to the login). Signing out brings you back to Engage.
2. **State your position**: pick a role. Each one signs in with password `ncc-<name>`:

   | User | Role | Sees |
   |---|---|---|
   | `captain` | Captain | everything on the Enterprise, every command. The Starfleet (fleet) station is locked for this role |
   | `engineer` | Chief Engineer | warp, power, shields, hull, decks, transporter |
   | `medical` | Chief Medical Officer | 430 crew biosigns, life support (medical privacy) |
   | `science` | Science Officer | sensors, helm, shields, hull |
   | `comms` | Communications Officer | comms, helm, sensors |
   | `command` | Starfleet Command | the whole task force and the Starfleet station, scenarios, server metrics |

Log in as `command` to see the fleet: all four ships on the sector map and the scenario launcher. The other roles see the Enterprise only.

3. You board and reach the bridge automatically. Press **SCENARIO** and run *Balance of Terror*. The scenario raises red alert itself when the enemy ship appears. Press `V` to switch the viewscreen to the tactical view, and press **FIRE PHASERS** when it lights up.
4. History and Alerts are pages without a station button. Press `Ctrl K` to open the turbolift, type "History" or "Alerts" and press Enter, or open `/history` and `/alerts` on the same address.

Sound is off by default. Press `M` to turn it on.

## Features

- **Live bridge and seven stations.** Helm, Engineering, Science, Communications, Sickbay, Starfleet Command, plus History and Alerts. Monitors show live values with sparklines, gauges, a sector map, a 430-crew biosign grid and a 3D viewscreen (react-three-fiber) that streaks into warp.
- **Role-based access enforced on the server.** Every role joins only the Socket.IO rooms and history it is allowed. The engineer never receives crew medical data, and the doctor never receives the warp core. Locked stations show why.
- **Anomaly detection.** Threshold rules, a rolling z-score (|z| > 4 held for 0.5 s) and link loss. A critical alert in a vital system raises the ship to yellow alert, and alerts can be acknowledged by role.
- **Commands back to the ship.** Warp, shields, phasers, hail, power presets, transporter, quarantine, inoculate and cold restart. Each is validated, checked against the role, rate-limited, sent to the simulator and acknowledged in the captain's log ("Warp factor 6, aye").
- **Six playable episodes.** Scripted incidents that exercise the pipeline: *Balance of Terror* (anomaly detection, red alert), *The Naked Time* (430-crew stream, medical privacy), *The Doomsday Machine* (link loss, history of a lost ship), *Mirror, Mirror* (duplicates, reordering, malformed data), *The Trouble with Tribbles* (per-deck forecast) and *Space Seed* (forged data, rate limits, device keys).
- **History merged with live data.** Charts load stored data and keep streaming, with no gap and no duplicate at the join, even after a reconnect.
- **Original-series sound.** Klaxons, phasers, the hailing whistle and a heartbeat at the patient's live heart rate, all on the Web Audio API. Muted by default.

| | |
|---|---|
| ![Red alert: shields at 30 %, a torpedo hit fuzzing the viewscreen](docs/screenshots/app-red-alert.png) | ![Engineering: reaction chamber, dilithium, nacelles, power, transporter, decks](docs/screenshots/app-engineering.png) |
| **Red alert.** A torpedo hit takes the fore shield to 30 % and the alerts land in the log. | **Engineering.** Every monitor is a live channel, and the desk buttons are real commands. |
| ![Sickbay during The Naked Time: the infection spreading through deck 7](docs/screenshots/app-sickbay.png) | ![Starfleet Command: sector map, fleet log, server metrics, scenarios](docs/screenshots/app-starfleet-command.png) |
| **Sickbay.** The Psi 2000 infection spreads through deck 7, each crew member measured against their own baseline. | **Starfleet Command.** The task force on a sector map, the fleet's alerts, live server latency and the scenario launcher. |

## Tech stack

| Layer | Tech |
|---|---|
| Database | **MongoDB 8**: time-series collection for telemetry, TTL retention, Mongoose |
| Server | **Node.js, Express 5, Socket.IO 4** with MessagePack, zod validation, JWT auth with bcrypt, express-rate-limit |
| Client | **React 19, Vite 6**, React Router 7, uPlot for charts, three.js with react-three-fiber and drei for the 3D ship and viewscreen, Web Audio |
| Simulator | Node.js ship physics and crew vitals, the same wire format as any real device |
| Ops | Docker Compose locally. Render (server with embedded simulator), Vercel (client) and MongoDB Atlas when hosted |

## How the data is generated

There's no hardware, so `simulator/` plays the ships, and it talks to the server exactly as a real device would:

- **4 ships** (Enterprise, Constellation, Exeter, Intrepid), each starting at its own position, heading and warp factor and drifting slowly, each running a physics model: matter/antimatter reaction, dilithium wear, nacelle balance, power allocation, shields that take hits and recharge, hull stress, oxygen and CO₂ on twelve decks, sensor contacts, transporter cycles and subspace comms. 121 channels per sample, at 50 Hz for the Enterprise and 20 Hz for the others.
- **4 sickbay hubs**, one per ship. Each streams heart rate, respiration, body temperature and neural activity for all **430 crew**, every crew member with their own baseline. That's 1,720 values a second per hub.
- **Scenarios** steer the simulator through `sim:command` verbs (`hit`, `ramp`, `fault`, `crew`, `mute`), so an episode is real telemetry that the detector has to catch, not canned alerts.

Locally that adds up to about 110 ship samples and 4 crew samples a second: about 115 samples a second, or roughly **20,000 channel values a second**. The whole domain (sources, channels, ranges, roles, alert rules) is one file, `shared/registry.js`.

## How real-time works

```
simulator ──telemetry:batch──▶ /ingest ─▶ validate ─▶ rate limit ─▶ dedup ─▶ detector ─▶ alerts
                                                            │
                                                            ├─▶ batched writer ─▶ MongoDB (time series)
                                                            └─▶ broadcaster ─▶ /live rooms ─▶ dashboards
```

- **Ingest (`/ingest` namespace).** Each source has one authenticated Socket.IO connection and sends batches of packed integer samples (`[seq, ts, v0, v1, …]`, MessagePack). Every batch is acked with counts and a `credit`, so the source slows down when the server is behind: backpressure from MongoDB all the way back to the device.
- **Processing.** zod and range checks drop malformed samples, and a per-source token bucket drops floods. A sequence window catches duplicates, stale data and out-of-order arrivals and detects source restarts. The anomaly detector then runs on what's left.
- **Storage.** A writer batches samples into `insertMany({ ordered: false })` every 250 ms into a MongoDB time-series collection. History queries downsample with `$bucketAuto` and include samples not yet flushed.
- **Fan-out (`/live` namespace), rooms per role:**
  - `src:<id>:<group>`: one channel group of one source (`src:1:shields`). A client subscribes, and the server joins only the groups its role may see.
  - `ship:<id>`: ship events such as condition, captain's log, scenario progress and visual effects.
  - `overview:<role>`, `alerts:<group>`, `admin`: the 5 Hz fleet summary (only the ships of that role, with helm and shield columns blank for roles without those groups), alerts by group, and server metrics.
- **Batching and throttling.** The broadcaster sends **one frame per room every 50 ms** (built once, sent to every subscriber), not one message per sample. The overview is volatile, so slow clients drop it instead of queueing. On the client, frames go into ring buffers outside React state and are drawn on one shared animation-frame loop.

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (diagrams of the system, data flow and DB schema), [`docs/PROTOCOL.md`](docs/PROTOCOL.md) (wire format, rooms, REST API), [`docs/DOMAIN.md`](docs/DOMAIN.md) (channels, roles, alert rules, scenarios), [`docs/DESIGN.md`](docs/DESIGN.md) (the design system).

## Performance

On one laptop, with the full simulator running in the same process ([`docs/PERFORMANCE.md`](docs/PERFORMANCE.md)):

| Run | Sources | Dashboards | Samples / s | End to end p50 / p95 / p99 | Errors |
|---|---|---|---|---|---|
| medium | 40 × 10 Hz | 100 | 399 | 102 / 158 / 176 ms | 0 |
| large | 80 × 10 Hz | 250 | 799 | 107 / 169 / 188 ms | 0 |
| stretch | 85 × 20 Hz | 600 | 1,696 | 117 / 172 / 186 ms | 0 |

The large run used under half of one CPU core. In a fault-injection run (5 % duplicates, 5 % reordered, 2 % malformed) every injected duplicate and malformed sample was caught.

## Run without Docker, and test

```bash
npm install
docker run -d --rm --name ncc-mongo -p 127.0.0.1:27017:27017 mongo:8   # or any local mongod
npm run dev -w server        # http://localhost:4000
npm start -w simulator       # four ships and four sickbay hubs
npm run dev -w client        # http://localhost:5173
```

Or skip the separate simulator with `SIM_EMBED=1 npm run dev -w server`.

```bash
npm test                     # shared, server (needs MongoDB on 127.0.0.1:27017) and client tests
npm run loadtest:smoke       # 15 s load test against a running server
npm run loadtest -- --preset large
```

Configuration is in `.env.example`. With `NODE_ENV=production` the server refuses the example secrets.

## Hosting

`render.yaml` deploys the server with the simulator embedded (`SIM_EMBED=1`, lower rates for the free tier) to a free Render web service. `vercel.json` builds the client, with `VITE_API_URL` pointing at the server, and MongoDB runs on an Atlas M0 cluster.

Step-by-step setup and the CI/CD pipeline (GitHub Actions tests every pull request and every push to main, Render and Vercel deploy main, Vercel previews every pull request) are in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## What is new in this repository

The real-time engine (ingest with validation, de-duplication and rate limits, the batched time-series writer, history merged with live data, rooms, the alert detector, the load test, the client live store, Chart and VirtualList) is adapted from PitWall, a race-car telemetry project our team wrote earlier inside this hackathon's window. We reused it and did not write it from scratch here. The race-specific parts were removed and the wire format was made data-driven.

Written for this project:

- The domain: `shared/registry.js` (4 ships, 121 channels each, 430 crew, roles, alert rules) and the six scenario scripts in `shared/scenarios/`.
- The simulator's ship physics and crew vitals model.
- The ship world on the server: condition (green, yellow, red), the captain's log, commands from the stations, the scenario runner, and role access by ship and channel group, including crew medical privacy.
- The whole bridge client: stations, the 3D viewscreen, Starfleet fleet view, sickbay biosign grid and the sound system.

## Optional audio

The opening narration (`client/public/audio/intro.mp3`) and the sound effects (`client/public/sfx/`) are copyrighted original-series audio, listed in [`CREDITS.md`](CREDITS.md). They are optional. Delete those two folders, or replace the files under the same names with your own, and the app still runs: missing effects fall back to sounds synthesized in the browser, and the opening plays without narration.

## Credits and disclaimer

Third-party assets (the 3D Enterprise model, the opening narration, the original-series sound effects and the fonts) are listed with their sources and licences in [`CREDITS.md`](CREDITS.md).

*Star Trek* and all related marks, names, ships, sounds and images belong to CBS Studios and Paramount. This is a non-commercial fan project made for a college hackathon, not affiliated with or endorsed by them.
