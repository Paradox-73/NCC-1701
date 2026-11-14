# NCC-1701 Bridge telemetry domain

What streams, how fast, what counts as normal, what raises an alert, who may see what, and the six episode scenarios that drive the demo. The engine's `shared/registry.js` (branch `feat/engine`) holds this content as data; its placeholder gets replaced from this file. Names here match the registry's exports: `SOURCES`, `GROUP_DEFS`, `CHANNELS`, `ROLES`, `RULES`. How it looks is in `DESIGN.md`; sources are in `RESEARCH.md`.

## 1. Sources

A source is one connection to `/ingest` with its own sequence numbers. There are two kinds:

- **ship**: one per starship. Every ship channel in section 3, sampled together at the ship's rate.
- **crew**: one per ship, the sickbay biomonitor hub. Four vital signs for each of the 430 crew members in one sample, once a second. The show gives the Enterprise a crew of 430 (`RESEARCH.md`).

The task force is the Enterprise and three Constitution-class sister ships from the original series.

| id | Kind | Name | Registry | Rate, local | Rate, hosted | Role in the demo |
|---|---|---|---|---|---|---|
| 1 | ship | USS Enterprise | NCC-1701 | 50 Hz | 20 Hz | Our ship; every scenario |
| 2 | ship | USS Constellation | NCC-1017 | 20 Hz | 5 Hz | Wrecked in The Doomsday Machine |
| 3 | ship | USS Exeter | NCC-1672 | 20 Hz | 5 Hz | Task force |
| 4 | ship | USS Intrepid | NCC-1631 | 20 Hz | 5 Hz | Task force |
| 11 | crew | Enterprise sickbay | | 1 Hz | 1 Hz | 430 crew biosigns |
| 12-14 | crew | Sickbay of ships 2-4 | | 1 Hz | off | Load for the stress test |

The hosted rates keep a free MongoDB tier from filling: measure `db.stats()` after ten minutes of hosted running and halve the ship rates if storage grows by more than 200 MB an hour.

### Volume

| Profile | Ship samples per second | Readings per second |
|---|---|---|
| Local | 50 + 3 × 20 = 110 samples of 121 channels, plus 4 crew samples of 1,720 values | 13,310 + 6,880 = about 20,000 |
| Hosted | 20 + 3 × 5 = 35 samples, plus 1 crew sample | 4,235 + 1,720 = about 6,000 |

A reading is one channel value. The load test scales ships and rates past this; report readings per second, samples per second and connected dashboards together.

### Engine changes this model needs

The engine today has one channel list for every source, one rate per source and source ids up to 99. This model needs:

1. **Source kinds.** `KINDS = { ship: { channels, groups }, crew: { channels, groups } }` and `SOURCES[i].kind`. `SAMPLE_LEN`, `CHANNEL_INDEX`, `GROUP_CHANNELS`, `packSample`, `unpackSample` and `checkPacked` look the kind up by source id. The crew channel list is generated in code (section 4).
2. **Roles with ships and commands.** Each role gets `ships` (source ids it may see) and `commands` (command types it may send), as in section 6.
3. **Wider overview rows.** `[sourceId, flags, condition, warpFactor×100, weakestShield×10, posX×10, posY×10, heading×10]`, so the bridge tiles and the fleet map need no telemetry subscription. 5 Hz, volatile, as now.
4. **Ship state on the server.** Condition per ship, the command route, the scenario runner and a room `ship:<id>` for condition changes, log lines, scenario progress and command acknowledgements (sections 6 to 8).
5. **Ingest security alerts.** Alerts raised from the ingest counters: refused handshakes, invalid samples and throttled samples per second (section 5).
6. **Stored rate per kind.** `storeEvery` in each kind: the crew hub stores one sample in 5 when hosted; live frames stay at 1 Hz.

If time runs out, cut items 5 and 6 first.

### Stardate

`stardate(ts) = 1000 + (ts - Date.UTC(2026, 0, 1)) / 8_640_000`: ten units a day, about 4170 in mid-November 2026, one decimal in the top bar, two in log lines. The original series used stardates between roughly 1000 and 6000 without a fixed rule, so any formula that stays in that range reads right.

## 2. Groups and rooms

A group is a set of channels that travel together. Groups are the room suffix, the unit of permission and the unit of subscription: a dashboard that watches `src:1:warp` never receives shield or deck data.

| Group | Kind | Channels | Main screen |
|---|---|---|---|
| `helm` | ship | 8 | Helm |
| `warp` | ship | 9 | Engineering |
| `impulse` | ship | 2 | Engineering |
| `shields` | ship | 6 | Helm |
| `weapons` | ship | 5 | Helm |
| `power` | ship | 6 | Engineering |
| `hull` | ship | 3 | Engineering |
| `lifesupport` | ship | 48 (12 decks × 4) | Engineering |
| `gravity` | ship | 12 | Engineering |
| `sensors` | ship | 8 | Science |
| `transporter` | ship | 4 | Engineering, Science |
| `comms` | ship | 6 | Communications |
| `crewsummary` | ship | 4 | Bridge, Sickbay, Starfleet Command |
| `bio-d01` to `bio-d12` | crew | 4 × the crew on that deck | Sickbay |

Rooms on `/live`:

| Room | Who joins | Events |
|---|---|---|
| `src:<sourceId>:<group>` | Clients that subscribed and whose role allows the group and the source | `telemetry:frame` every 50 ms, only new samples, only that group's channels |
| `overview` | Everyone signed in | `overview`, 5 Hz, volatile |
| `ship:<shipId>` | That ship's roles and Starfleet Command | `condition`, `log`, `scenario`, `command:ack` |
| `alerts` and `alerts:<group>` | By role, as the engine does now | `alert`, `alert:ack` |
| `admin` | Starfleet Command | `metrics`, 1 Hz |

The crew hub of ship N has id N + 10, so its rooms are `src:11:bio-d07` and so on.

## 3. Ship channels

Every ship sends all 121 channels in every sample. Columns: the registry `key`; the unit; `min` to `max`, the range the server accepts; `scale`, the integer multiplier on the wire; the normal running value; the warn and critical limits for threshold rules; and how the simulator drives the value.

Drift models used below:

- **OU(μ, σ)**: noise that pulls back toward μ, an Ornstein-Uhlenbeck process: `x += θ(μ - x)dt + σ√dt·N(0,1)` with θ = 0.5 per second unless stated.
- **lag(target, τ)**: moves toward a target with time constant τ, plus small noise.
- **scenario**: holds a value until a scenario step changes it.

Limits marked "our choice" are not from the show; the show gives almost no numbers for ship systems.

### `helm`

| key | Label | Unit | min-max | scale | Normal | Warn | Critical | Drift |
|---|---|---|---|---|---|---|---|---|
| `warpFactor` | Warp factor | | 0-9.99 | 100 | As ordered; cruise 6 | > 8.5 | > 9.2 | lag(order, 2 s), σ 0.01 |
| `impulse` | Impulse power | % | 0-100 | 10 | As ordered; 0 at warp | | | lag(order, 1 s) |
| `speed` | Speed | c | 0-1000 | 10 | warpFactor³ at warp; impulse/100 × 0.25 at impulse | | | derived |
| `heading` | Heading | ° | 0-360 | 10 | As ordered | | | turns toward the order at 3°/s |
| `posX` | Position X | su | -5000 to 5000 | 10 | Integrated from speed and heading | | | derived |
| `posY` | Position Y | su | -5000 to 5000 | 10 | Same | | | derived |
| `orbitAlt` | Orbit altitude | km | 0-2000 | 1 | 0 when not in orbit; 400 in standard orbit | | | scenario |
| `descentRate` | Descent rate | m/s | -500 to 2000 | 1 | 0 | > 50 | > 200 | scenario |

Speed uses the cubic warp scale: warp factor cubed times the speed of light. Positions are on a fictional sector grid in sector units (su). The simulator moves a ship `speed / 400` su per second, so a ship at warp 6 crosses the 1000 su map in about half an hour and visibly moves on the fleet map.

### `warp`

| key | Label | Unit | min-max | scale | Normal | Warn | Critical | Drift |
|---|---|---|---|---|---|---|---|---|
| `reactionRate` | Matter/antimatter reaction rate | % of rated | 0-130 | 10 | 10 + 9 × warpFactor, so 64 at warp 6 | > 95 | > 105 | lag(target, 1.5 s), σ 0.4 |
| `intermixDev` | Intermix deviation from 1:1 | % | 0-50 | 100 | 0.2-1.5 | > 5 | > 10 | absolute value of OU(0.8, 0.2) |
| `dilithiumEff` | Dilithium crystal efficiency | % | 0-100 | 10 | 95-99 | < 80 | < 60 | falls 0.01%/s above warp 8, recovers 0.005%/s below |
| `dilithiumTemp` | Crystal chamber temperature | °C | 0-2000 | 1 | 450 + 40 × warpFactor | > 900 | > 1100 | lag(target, 5 s), σ 3 |
| `chamberTemp` | Reaction chamber temperature | MK | 0-100 | 10 | 20 + 4 × warpFactor, so 44 at warp 6 | > 70 | > 85 | lag(target, 3 s), σ 0.3 |
| `nacellePort` | Port nacelle output | % | 0-130 | 10 | reactionRate × 0.98 | | | follows, σ 0.5 |
| `nacelleStbd` | Starboard nacelle output | % | 0-130 | 10 | reactionRate × 0.98 | | | follows, σ 0.5 |
| `nacelleDelta` | Nacelle imbalance | % | 0-100 | 10 | 0-2 | > 5 | > 12 | the difference of the two |
| `warpField` | Warp field stability | % | 0-100 | 10 | 97-100 | < 90 | < 80 | OU(99, 0.2) |

All limits are our choice. The chamber limits keep the engine placeholder's values.

### `impulse`

| key | Label | Unit | min-max | scale | Normal | Warn | Critical | Drift |
|---|---|---|---|---|---|---|---|---|
| `impulseReactor` | Impulse reactor output | % | 0-130 | 10 | Equal to `impulse` | > 100 | > 115 | lag(impulse, 1 s) |
| `impulseTemp` | Impulse reactor temperature | °C | 0-2000 | 1 | 300 + 3 × impulseReactor | > 800 | > 1000 | lag(target, 4 s), σ 2 |

### `shields`

| key | Label | Unit | min-max | scale | Normal | Warn | Critical | Drift |
|---|---|---|---|---|---|---|---|---|
| `shieldsUp` | Shields raised | 0 or 1 | 0-1 | 1 | 0 at normal condition, 1 at yellow or red | | | command |
| `shieldFore` | Shield strength, fore | % | 0-100 | 10 | 98-100 | < 50 | < 25 | +2%/s back to 100; hits subtract |
| `shieldAft` | Shield strength, aft | % | 0-100 | 10 | 98-100 | < 50 | < 25 | same |
| `shieldPort` | Shield strength, port | % | 0-100 | 10 | 98-100 | < 50 | < 25 | same |
| `shieldStbd` | Shield strength, starboard | % | 0-100 | 10 | 98-100 | < 50 | < 25 | same |
| `shieldLoad` | Shield generator load | % | 0-150 | 10 | 10 lowered, 35 raised | > 85 | > 100 | +20 per hit, decays with τ 4 s |

A quadrant's strength is the charge available. With shields lowered a hit goes to `hullIntegrity` instead, so a ship cruising with shields down raises no shield alerts.

### `weapons`

| key | Label | Unit | min-max | scale | Normal | Warn | Critical | Drift |
|---|---|---|---|---|---|---|---|---|
| `phaserFore` | Fore phaser bank charge | % | 0-100 | 10 | 100 | | | -40 per shot, +8%/s |
| `phaserAft` | Aft phaser bank charge | % | 0-100 | 10 | 100 | | | same |
| `phaserTemp` | Phaser coolant temperature | °C | 0-200 | 10 | 25-35 | > 80 | > 110 | +12 per shot, cools with τ 20 s |
| `torpedoes` | Photon torpedoes left | count | 0-50 | 1 | 24 at start, our choice | | | -1 per shot |
| `tubesLoaded` | Torpedo tubes loaded | count | 0-2 | 1 | 2 | | | reload in 4 s |

### `power`

| key | Label | Unit | min-max | scale | Normal | Warn | Critical | Drift |
|---|---|---|---|---|---|---|---|---|
| `powerTotal` | Total power output | % of rated | 0-130 | 10 | 40 + 7 × warpFactor + impulse × 0.2 | > 105 | > 115 | lag(target, 2 s) |
| `allocWarp` | Power to warp | % | 0-100 | 10 | Preset | | | lag(preset, 1 s) |
| `allocShields` | Power to shields | % | 0-100 | 10 | Preset | | | same |
| `allocWeapons` | Power to weapons | % | 0-100 | 10 | Preset | | | same |
| `allocLife` | Power to life support | % | 0-100 | 10 | Preset | | | same |
| `battery` | Emergency battery charge | % | 0-100 | 10 | 100 | < 50 | < 20 | drains 1%/s while powerTotal < 25 |

Presets, warp/shields/weapons/life support: CRUISE 55/15/10/20, COMBAT 30/35/25/10, EMERGENCY 10/40/10/40. Red alert switches to COMBAT; stand down switches back to CRUISE.

### `hull`

| key | Label | Unit | min-max | scale | Normal | Warn | Critical | Drift |
|---|---|---|---|---|---|---|---|---|
| `hullIntegrity` | Hull integrity | % | 0-100 | 10 | 100 | < 75 | < 50 | falls only on hits |
| `hullTemp` | Hull temperature | °C | -150 to 2000 | 1 | -20 to 10 | > 400 | > 900 | OU(-10, 1) |
| `hullStress` | Structural stress | % of limit | 0-150 | 10 | 5-15, plus 2 per warp factor above 8 | > 70 | > 90 | OU, plus scenario |

### `lifesupport` and `gravity`, per deck

Twelve decks, `NN` = `01` to `12`. Deck 1 is the bridge. The other names are our choice, since the show never gave a full deck plan: 2 officers' quarters, 3 crew quarters, 4 laboratories, 5 sickbay, 6 recreation, 7 transporter rooms, 8 shuttle hangar, 9 cargo and food stores, 10 life support plant and hydroponics, 11 main engineering, 12 impulse and auxiliary control.

| key | Label | Unit | min-max | scale | Normal | Warn | Critical | Drift |
|---|---|---|---|---|---|---|---|---|
| `o2_NN` | Oxygen, deck NN | % | 0-30 | 100 | 20.6-21.2 | < 19.5 | < 17 | OU(20.9, 0.03), θ 0.2 |
| `co2_NN` | Carbon dioxide, deck NN | ppm | 0-20000 | 1 | 400-900 | > 2000 | > 5000 | OU(600, 15) |
| `temp_NN` | Temperature, deck NN | °C | -50 to 80 | 10 | 20.5-22.5 | > 30 or < 12 | > 40 or < 5 | OU(21.5, 0.05) |
| `press_NN` | Pressure, deck NN | kPa | 0-150 | 10 | 100.5-102 | < 90 | < 75 | OU(101.3, 0.05) |
| `grav_NN` | Artificial gravity, deck NN | g | 0-3 | 1000 | 0.99-1.01 | < 0.8 or > 1.2 | < 0.5 or > 1.5 | OU(1.0, 0.002) |

`o2_NN`, `co2_NN`, `temp_NN` and `press_NN` are in group `lifesupport`; `grav_NN` is in group `gravity`. Two-sided limits are two rules on the same channel, one with `dir: 'high'` and one with `dir: 'low'`, with different `type` names.

### `sensors`

| key | Label | Unit | min-max | scale | Normal | Warn | Critical | Drift |
|---|---|---|---|---|---|---|---|---|
| `lrSensor` | Long-range sensor health | % | 0-100 | 10 | 96-100 | < 70 | < 40 | OU(98.5, 0.2) |
| `srSensor` | Short-range sensor health | % | 0-100 | 10 | 96-100 | < 70 | < 40 | OU(98.5, 0.2) |
| `contacts` | Contacts tracked | count | 0-50 | 1 | 0-2 | | | scenario |
| `contactBearing` | Nearest contact bearing | ° | 0-360 | 10 | | | | scenario |
| `contactRange` | Nearest contact range | km | 0-1,000,000 | 1 | 1,000,000 with no contact | < 50,000 | < 10,000 | scenario |
| `contactSnr` | Nearest contact signal strength | dB | 0-60 | 10 | 1-3, the noise floor | | | OU(2, 0.3); statistics only |
| `ionFlux` | Ion flux | index | 0-100 | 10 | 2-6 | > 40 | > 70 | OU(4, 0.3) |
| `lifeforms` | Unregistered life-forms aboard | count | 0-2,000,000 | 1 | 0 | > 100 | > 10,000 | scenario |

### `transporter`

| key | Label | Unit | min-max | scale | Normal | Warn | Critical | Drift |
|---|---|---|---|---|---|---|---|---|
| `xpState` | Transporter state | 0 idle, 1 energizing, 2 transporting, 3 fault | 0-3 | 1 | 0 | | 3 | command and scenario |
| `xpEnergy` | Transporter energy | MW | 0-60 | 10 | 0 idle, 15-20 in a cycle | > 30 | > 40 | command and scenario |
| `xpLock` | Signal lock | % | 0-100 | 10 | 100 | < 90 | < 75 | scenario |
| `xpPattern` | Pattern integrity | % | 0-100 | 100 | 100 | < 98 | < 95 | scenario |

The fault rule is `{ type: 'transporter-fault', channel: 'xpState', dir: 'high', warn: 2.5, critical: 2.9 }`.

### `comms`

| key | Label | Unit | min-max | scale | Normal | Warn | Critical | Drift |
|---|---|---|---|---|---|---|---|---|
| `carrier` | Subspace carrier strength | dB | 0-80 | 10 | 42-48 | < 25 | < 12 | OU(45, 0.4) |
| `delay` | Signal delay to Starfleet Command | s | 0-600 | 10 | 0.5-2 | > 10 | > 30 | OU(1.2, 0.1) |
| `loss` | Message loss | % | 0-100 | 10 | 0-1 | > 10 | > 30 | OU(0.3, 0.1) |
| `interference` | Interference | % | 0-100 | 10 | 1-5 | > 30 | > 60 | OU(3, 0.3) |
| `channelsOpen` | Open channels | count | 0-16 | 1 | 1-3 | | | command |
| `hailing` | Hailing frequencies open | 0 or 1 | 0-1 | 1 | 0 | | | command |

### `crewsummary`

Visible to every role, including those who may not see biosigns. The simulator computes it from the same crew model that drives the crew hub, so the counts match Sickbay.

| key | Label | Unit | min-max | scale | Normal | Warn | Critical | Drift |
|---|---|---|---|---|---|---|---|---|
| `crewAboard` | Crew aboard | count | 0-1000 | 1 | 430 | | | scenario |
| `crewWatch` | Crew on medical watch, any vital past its warn limit | count | 0-1000 | 1 | 0-4 | > 15 | > 60 | derived |
| `crewCritical` | Crew in critical condition | count | 0-1000 | 1 | 0 | > 0 | > 5 | derived |
| `crewMeanHr` | Mean crew heart rate | bpm | 0-250 | 10 | 68-76 | | | derived; statistics only |

## 4. Crew biosign channels

The crew hub sends one sample a second with four vitals for each crew member `NNN` = `001` to `430`: 1,720 values. Crew 001-012 are on deck 1; decks 2 to 12 hold 38 each. Crew members appear as "Crew 207 · Operations · Deck 7"; no names, so nothing personal leaves Sickbay. Each crew member has a personal baseline drawn once from a seeded random generator.

| key | Label | Unit | min-max | scale | Normal | Warn | Critical | Drift |
|---|---|---|---|---|---|---|---|---|
| `hr_NNN` | Heart rate | bpm | 0-250 | 1 | Baseline 55-85 | > 120 or < 45 | > 150 or < 35 | OU(baseline, 1.5) |
| `rr_NNN` | Respiration | breaths/min | 0-80 | 1 | 12-18 | > 28 | > 35 | OU(baseline, 0.3) |
| `bt_NNN` | Body temperature | °C | 25-45 | 10 | 36.5-37.2 | > 38.5 or < 35.5 | > 40 or < 34 | OU(baseline, 0.02) |
| `nr_NNN` | Neural activity | % of baseline | 0-300 | 1 | 92-108 | > 140 or < 60 | > 170 or < 40 | OU(100, 1) |

All limits are our choice, loosely based on human resting ranges. Group `bio-dNN` holds the four channels of every crew member on deck NN, so a doctor watching deck 7 receives 152 values a second, not 1,720.

Generating them in `registry.js`:

```js
const DECK_OF = (n) => (n <= 12 ? 1 : 2 + Math.floor((n - 13) / 38)); // crew 1-12 on deck 1, then 38 per deck
const pad = (n, w = 3) => String(n).padStart(w, '0');
const VITALS = [
  { v: 'hr', label: 'Heart rate', unit: 'bpm', min: 0, max: 250, scale: 1, hi: [120, 150], lo: [45, 35] },
  { v: 'rr', label: 'Respiration', unit: '/min', min: 0, max: 80, scale: 1, hi: [28, 35] },
  { v: 'bt', label: 'Body temperature', unit: '°C', min: 25, max: 45, scale: 10, hi: [38.5, 40], lo: [35.5, 34] },
  { v: 'nr', label: 'Neural activity', unit: '%', min: 0, max: 300, scale: 1, hi: [140, 170], lo: [60, 40] },
];
const CREW_CHANNELS = [];
for (let n = 1; n <= 430; n++)
  for (const x of VITALS)
    CREW_CHANNELS.push({ key: `${x.v}_${pad(n)}`, label: `${x.label}, crew ${pad(n)}`, unit: x.unit,
      min: x.min, max: x.max, scale: x.scale, group: `bio-d${pad(DECK_OF(n), 2)}` });
```

Per-crew alerts go only to `alerts:bio-dNN`, which only the chief medical officer and the captain join. Everyone else sees the effect through `crewWatch` and `crewCritical`. The dashboard folds many crew alerts on one deck into one log row ("23 crew on watch, deck 7").

## 5. Alerts

Three detectors, all already in the engine:

1. **Thresholds.** The warn and critical columns above, as `RULES.thresholds` entries `{ type, channel, dir, warn, critical }`. The deck and crew rules are generated in loops like the channels.
2. **Statistics.** A rolling mean and standard deviation per source and channel over about 10 s of sample time; an alert when |z| > 4 holds for 0.5 s, after a 30 s warm-up. `RULES.zChannels`: `chamberTemp`, `reactionRate`, `dilithiumTemp`, `impulseTemp`, `contactSnr`, `carrier`, `xpEnergy`, `crewMeanHr`, and every `hr_NNN` and `nr_NNN`. `contactSnr` has no fixed limit on purpose: the sensor ghost in Balance of Terror is too weak for a threshold and only the statistics catch it.
3. **Link loss.** No samples from a source for 1.5 s raises a warn alert; 30 s marks it offline.

One more detector this model adds, on the server's own ingest counters, per source, over a 2 s window:

| type | Condition | Severity |
|---|---|---|
| `ingest-auth` | 3 or more refused `/ingest` handshakes | warn |
| `ingest-invalid` | More than 20 invalid samples a second | warn |
| `ingest-flood` | More than 200 throttled samples a second | critical |

Severity `warn` is shown as YELLOW and `critical` as RED, matching the two alert levels of the show. Alerts are debounced per source and type: one open alert until the condition has been clear for 3 s; a rise in severity sends one more.

### Ship condition

Each ship has a condition: `normal`, `yellow` or `red`. It is separate from alert severity: alerts belong to channels, condition belongs to the ship. It changes in three ways:

- The captain orders it: `R`, `Y`, `N`, or the bridge buttons.
- A scenario step sets it.
- A critical alert in `hull`, `shields`, `lifesupport`, `warp` or `crewsummary` raises a ship at `normal` to `yellow`. Only the captain or a scenario sets red, as on the show, where red alert is the captain's order.

Yellow and red raise the shields (`shieldsUp` = 1); red also switches power to COMBAT.

## 6. Roles and access

The server checks every subscription, history request, alert acknowledgement and command against the role in the JWT. The dashboard only hides what the server would refuse.

| Role | `ROLES` key | Sources | Groups | Commands |
|---|---|---|---|---|
| Captain | `captain` | 1, 11 | All ship groups, all `bio-dNN` | All shipboard commands, scenarios |
| Chief engineer | `chief_engineer` | 1 | `warp`, `impulse`, `power`, `shields`, `weapons`, `hull`, `lifesupport`, `gravity`, `transporter`, `crewsummary` | `engineering.*`, `transporter.energize` |
| Chief medical officer | `chief_medical_officer` | 1, 11 | `crewsummary`, `lifesupport`, `gravity`, all `bio-dNN` | `medical.*` |
| Science officer | `science_officer` | 1 | `sensors`, `helm`, `shields`, `hull`, `transporter`, `comms`, `crewsummary` | `science.scan` |
| Communications officer | `communications_officer` | 1 | `comms`, `helm`, `sensors`, `crewsummary` | `comms.*` |
| Starfleet Command | `starfleet_command` | 1-4 | All ship groups; no `bio-dNN` | `scenario.*`, `sim.fault`; metrics |

Every role may acknowledge alerts in the groups it can see. Biosigns are private to the chief medical officer and the captain: not even Starfleet Command sees an individual crew member's vitals, only `crewsummary`. The demo should show this: open Sickbay as the chief engineer and get the restricted monitor, then as the doctor and get the crew grid.

One demo account per role, seeded when the users collection is empty. The login screen has a button for each.

## 7. Commands

`POST /api/ships/:id/command` with `{ type, ...payload }`. The server validates the payload with zod, checks the role, applies a per-user token bucket of 10 commands a second with a burst of 20, and relays the command to the ship's simulator as `sim:command`. It answers `{ ok, at }`, sends `command:ack` to `ship:<id>`, and writes a log line ("Warp factor 6, aye"). The simulator's effect shows up in the telemetry within one sample. Unknown type: 400. Wrong role: 403. A scenario-only command when no scenario waits for it: 409.

| type | Payload | Roles | Effect |
|---|---|---|---|
| `helm.warp` | `{ factor: 0-9 }` | captain | Order for `warpFactor`; 0 drops to impulse |
| `helm.impulse` | `{ percent: 0-100 }` | captain | Order for `impulse` |
| `helm.heading` | `{ deg: 0-359 }` or `{ delta: -90 to 90 }` | captain | Order for `heading` |
| `helm.stop` | `{}` | captain | Warp 0, impulse 0 |
| `tactical.shields` | `{ up: boolean }` | captain | `shieldsUp` |
| `tactical.phasers` | `{ bank: 'fore' or 'aft' }` | captain | Fires at the nearest contact; 1 s cooldown |
| `tactical.torpedo` | `{}` | captain | Needs a loaded tube |
| `ship.condition` | `{ level: 'normal', 'yellow' or 'red' }` | captain | Ship condition |
| `comms.hail` | `{ target: shipId or 'command' }` | captain, communications officer | `hailing` = 1, one more open channel |
| `comms.close` | `{}` | captain, communications officer | `hailing` = 0 |
| `engineering.allocate` | `{ preset: 'cruise', 'combat' or 'emergency' }` | captain, chief engineer | Power allocation |
| `engineering.coldRestart` | `{}` | captain, chief engineer | Scenario only |
| `transporter.energize` | `{}` | captain, chief engineer | One transporter cycle |
| `medical.inoculate` | `{ deck?: 1-12 }` | captain, chief medical officer | Infected crew recover over 20 s |
| `medical.quarantine` | `{ deck: 1-12 }` | chief medical officer | Stops spread from that deck in a scenario |
| `science.scan` | `{ mode: 'long', 'short' or 'focus' }` | captain, science officer | A scan pass; `focus` doubles `contactSnr` |
| `security.ventGas` | `{ deck: 1-12 }` | captain | Scenario only |
| `scenario.start` | `{ id }` | captain, Starfleet Command | Starts a scenario |
| `scenario.stop` | `{}` | captain, Starfleet Command | Stops it and restores normal running |
| `sim.fault` | `{ sourceId, fault: 'mute', 'storm' or 'spike' }` | Starfleet Command | Fault injection, as in the old engine |

## 8. Scenarios

Six episodes of the original series, each a timed script that drives the simulator. Each one shows a different requirement of the problem statement, so together they double as the demo checklist.

| # | Scenario | Episode | Length | What it shows |
|---|---|---|---|---|
| 1 | Balance of Terror | Season 1, 1966 | 95 s | Statistical anomaly detection, red alert, commands with acknowledgements, shield hits |
| 2 | The Naked Time | Season 1, 1966 | 110 s | The 430-crew stream, medical privacy by role, orbit decay, cold restart |
| 3 | The Doomsday Machine | Season 2, 1967 | 110 s | Several sources, fleet view, link loss, history of a lost ship |
| 4 | Mirror, Mirror | Season 2, 1967 | 70 s | Duplicate, out-of-order and malformed telemetry handled by dedup and validation |
| 5 | The Trouble with Tribbles | Season 2, 1967 | 85 s | Life support deck by deck, cascading alerts, a growth forecast from history |
| 6 | Space Seed | Season 1, 1967 | 90 s | Device keys, rate limiting, rejected forged data, role-checked commands |

Build them in this order; cut from the bottom.

### Script format

One file per scenario in `shared/scenarios/`, run by a scenario runner on the server. The runner sends simulator verbs as `sim:command`, writes log lines to `ship:<id>`, and broadcasts progress as `scenario` events `{ id, t, step, awaiting }`.

```js
export default {
  id: 'balance-of-terror',
  title: 'Balance of Terror',
  ships: [1],
  steps: [
    { t: 0, log: 'Outpost 4 reports an attack by a ship nobody can see.', sound: 'chirp' },
    { t: 0, cmd: { type: 'helm.warp', factor: 6 } },
    { t: 12, ramp: { ch: 'contactSnr', to: 7, over: 2 }, noise: { ch: 'contactSnr', sigma: 2.5 } },
    { t: 20, await: { type: 'ship.condition', level: 'red' }, timeout: 10 },
    // ...
  ],
};
```

Verbs: `log` (a captain's log line, with an optional sound cue), `cmd` (a command issued as if from the bridge), `set` (values now), `ramp` (to a value over seconds), `noise` (change σ of a channel), `hit` (a shield quadrant and amount; goes to the hull if shields are down), `contact` (add, move, cloak or remove a sensor contact), `crew` (infect, recover or set crew vitals), `fault` (mute a source, or a storm of duplicates and reordering), `condition`, `await` and `end`. `ch` is a channel key; `source` defaults to the scenario's first ship.

`await` pauses the clock until the named command arrives from a dashboard, which is the resolution step a presenter performs on camera. If nobody acts before `timeout` seconds, the runner issues the command itself, so every scenario also finishes unattended. When a scenario ends, every channel it touched drifts back to normal over 10 s.

### 1. Balance of Terror

Romulans destroy Earth outposts along the Neutral Zone with a ship that can turn invisible. It must become visible to fire its plasma torpedoes. Ship: Enterprise.

| t (s) | Event | Readings | Alerts |
|---|---|---|---|
| 0 | Log: "Outpost 4 reports an attack by a ship nobody can see." Warp 6. | `warpFactor` → 6 | |
| 8 | Log: "Outpost 4: signal lost." | | |
| 12 | Sensor ghost: a weak, broken return | `contactSnr` bursts 4-9 dB around a noise floor of 2; `contactBearing` drifts 40° to 55°; `contactRange` 80,000 km | Statistical: `contactSnr` z > 4, YELLOW |
| 20 | Await: captain orders red alert (`R`); timeout 10 s | Shields up, power to COMBAT | |
| 30 | The ship appears and fires a plasma torpedo | `contactSnr` 25; `contacts` 1; `shieldFore` 100 → 55; `shieldLoad` → 90 | `shieldLoad` > 85, YELLOW |
| 38 | Second torpedo | `shieldFore` 55 → 22; `hullIntegrity` 100 → 92 | `shieldFore` < 25, RED |
| 40 | It vanishes again | `contactSnr` back to the ghost | |
| 45 | Debris with a "metal-cased object" ahead. Await: phasers (`P`); timeout 10 s | `contacts` 2 | |
| 50 | The phaser shot sets off a hidden nuclear weapon; the blast shakes the ship | All quadrants -10; `phaserTemp` +30 | |
| 58 | Coolant leak in phaser control | `phaserTemp` 65 → 115 over 12 s | `phaserTemp` > 80 YELLOW, > 110 RED |
| 72 | The enemy appears to fire. Resolution, await: phasers (`P`); timeout 13 s | | |
| 75 | Hit. The enemy commander destroys his own ship | `contactSnr` → 0, `contacts` 0 | |
| 85 | Stand down | Shields recharge, `phaserTemp` cools, condition normal | |

### 2. The Naked Time

A landing party brings an infection back from a research station on the breaking-up planet Psi 2000. It spreads by touch and makes people act as if drunk. A crewman locks himself in engineering and shuts down the engines; the ship falls toward the planet. The engines cannot restart normally in time, so the crew tries an untested cold restart, which throws the ship 71 hours back in time. Ships: Enterprise and its crew hub.

| t (s) | Event | Readings | Alerts |
|---|---|---|---|
| 0 | Standard orbit of Psi 2000. Log: "Landing party back from the research station." | `orbitAlt` 400; warp 0; impulse 10; the planet on the viewscreen | |
| 5 | Crew 207, deck 7, shows symptoms | `hr_207` 72 → 115, `bt_207` → 38.2, `nr_207` → 150 | Crew 207 heart rate and neural, YELLOW, to Sickbay only |
| 15-60 | The infection spreads by touch: every 8 s each infected crew member infects one or two more, 80% on the same deck, else a neighbouring deck | Infected: `hr` +30-50, `nr` +40-80, `bt` +1; `crewWatch` 1 → 60+; `crewCritical` passes 5 | Per-crew alerts in Sickbay; `crewWatch` and `crewCritical` RED to every role |
| 40 | Log: "Engineering not responding." Engines shut down | `reactionRate`, `warpField`, `impulse`, `impulseReactor` → 0 over 5 s; `powerTotal` 85 → 20; `battery` starts draining | `battery` < 50 YELLOW later |
| 50 | Orbit decays | `descentRate` 0 → 300 m/s; `orbitAlt` 400 → 150 km; `hullTemp` -10 → 600 °C; the planet grows on the viewscreen | `descentRate` YELLOW then RED; `hullTemp` > 400 YELLOW |
| 70 | Await: the doctor's INOCULATE (Sickbay); timeout 10 s | Infected crew return to baseline over 20 s | Crew alerts close |
| 80 | Resolution, await: COLD RESTART (Engineering); timeout 15 s | `reactionRate` 0 → 110 in 2 s, then to 64; `warpFactor` surges to 8, then 0; `descentRate` → -100; `orbitAlt` climbs | `reactionRate` > 105, RED for 2 s |
| 85 | Time warp: the stardate rolls back 71 hours (29.6 units); the viewscreen streaks | | |
| 100 | Stand down | | |

On camera: open Sickbay as the chief engineer first (restricted), then as the doctor (the grid lights up deck by deck).

### 3. The Doomsday Machine

A planet-killing machine, miles long with a hull of solid neutronium, has wrecked the USS Constellation. It drains the Enterprise, wrecks its transporter and disrupts communications; phasers do nothing. The Constellation's impulse engines are rigged to explode after a 30 s delay that cannot be stopped, and it is flown into the machine's mouth. The transporter fails while beaming the pilot back and is fixed just in time. Ships: Enterprise and Constellation.

| t (s) | Event | Readings | Alerts |
|---|---|---|---|
| 0 | The Constellation's distress beacon. Fleet view | Ship 2: `hullIntegrity` 30, shields 0-5, `powerTotal` 10, `warpFactor` 0, `lrSensor` 20, `crewAboard` 430 → 1, `carrier` 8; its link drops for 3 s every 10 s | Ship 2: many RED; link loss YELLOW |
| 10 | Enterprise to the Constellation at warp 6 | | |
| 20 | Contact: an object miles long | `contacts` 1; `contactSnr` 40; `contactRange` 400,000 → closing | `contactRange` < 50,000 YELLOW at about t 35 |
| 30 | Its beam drains the shields, hits the transporter and the subspace radio | All quadrants -40 over 10 s; `shieldLoad` > 100; `xpState` 3; `carrier` → 15; `loss` → 25 | Shields RED; `transporter-fault` RED; `carrier` YELLOW; `loss` YELLOW |
| 45 | Await: phasers (`P`); timeout 8 s. No effect on neutronium. A tractor beam pulls the ship in | `hullStress` 15 → 85; `speed` falls; `contactRange` shrinking | `hullStress` > 70 YELLOW |
| 55 | The Constellation's last phaser bank distracts it; the Enterprise breaks free | Ship 2 `phaserFore` 100 → 0; `hullStress` falls | |
| 65 | The Constellation's impulse engines are rigged; a 30 s countdown shows on the bridge | Ship 2 `impulseReactor` 80 → 128 over 30 s | Ship 2 `impulseReactor` > 100 YELLOW, > 115 RED |
| 80 | Resolution, await: ENERGIZE in Engineering; the transporter fails first | Enterprise `xpState` 3, `xpPattern` 100 → 90, `xpLock` flickers 60-95, then recovers | `xpPattern` < 95 RED |
| 95 | The Constellation explodes inside the machine | Ship 2 stops sending for good; `contactSnr` 40 → 0; `contacts` 0 | Ship 2 link loss, then offline |
| 105 | Stand down. The fleet map shows the Constellation as LOST | | |

On camera: open the Constellation from the fleet view after it is lost. Its last two minutes load from MongoDB history and stop where the live stream ended. The simulator restarts ship 2 in normal running 30 s after the scenario ends.

### 4. Mirror, Mirror

An ion storm hits during a beam-up from the Halkan planet. The transporter swaps the landing party with their counterparts from a parallel universe. To get back, the engineer connects warp power to the transporter. Ship: Enterprise and its crew hub.

| t (s) | Event | Readings | Alerts |
|---|---|---|---|
| 0 | Orbit of the Halkan planet. Log: "The Halkan Council refuses. Landing party beaming up." | `orbitAlt` 400 | |
| 5 | The ion storm builds | `ionFlux` 3 → 75 over 20 s; `interference` 2 → 70; `carrier` 45 → 15; `loss` 0 → 35 | `ionFlux` YELLOW, RED; `interference` RED; `loss` RED; `carrier` YELLOW |
| 15 | The storm scrambles the telemetry: `fault: 'storm'` | The simulator resends 10% of samples, reorders 10% within 2 s, and sends 2% out of range | The charts stay clean. Starfleet Command's System monitor shows duplicates, stale and invalid samples per second climbing |
| 25 | Beam-up in the storm | `xpState` 1 → 2; `xpLock` → 60; `xpPattern` → 96 | `xpLock` RED; `xpPattern` YELLOW |
| 30 | The landing party arrives, wrong | Crew 001-004 `nr` shifts 35 from their baselines | Statistical alerts on 4 crew, Sickbay only |
| 45 | Resolution: EMERGENCY POWER, then ENERGIZE (Engineering); timeout 15 s | `xpEnergy` 18 → 34 MW; `xpLock` → 100; `xpPattern` → 100; crew 001-004 back to baseline | `xpEnergy` > 30 YELLOW for 3 s |
| 55 | The storm passes; duplicates stop | Storm channels fall back | Alerts close |

### 5. The Trouble with Tribbles

A trader gives a crew member a tribble at a space station. Tribbles multiply fast, get into the grain stores, and fill the ship until the engineer beams them all over to the Klingon ship. Ship: Enterprise.

The population follows `lifeforms = 11^(t'/10)`: it multiplies by 11 every 10 s, counted from the first tribble, until the transporter clears them.

| t (s) | Event | Readings | Alerts |
|---|---|---|---|
| 0 | Log: "Shore leave on the station. A gift comes aboard." | `lifeforms` 1 | |
| 0-60 | Growth, starting in the food stores on deck 9 and spreading through the vents to decks 10, 6, 5, 3 and 2, in that order | `lifeforms` 1 → 11 → 121 → 1,331 → 14,641 → 161,051 → 1,771,561. Per deck: `co2_NN` rises with the local population, `o2_NN` falls, `temp_NN` +2 °C | `lifeforms` > 100 YELLOW at t 20, > 10,000 RED at t 40; `co2_NN` YELLOW then RED, deck by deck |
| 30 | Science shows the forecast | | |
| 45 | Many tribbles in the grain hold are dead: the grain was poisoned | Growth on deck 9 stops; the curve bends | |
| 60 | Resolution, await: ENERGIZE (Engineering); timeout 15 s. Log: "Beamed them into the Klingon engine room." | `xpEnergy` 18 → 38 MW; `lifeforms` → 0 over 3 s; `co2_NN` back to normal over 20 s | `xpEnergy` > 30 YELLOW |
| 80 | Stand down | | |

The forecast is the historical-analysis piece: the Science monitor fits a straight line to log(`lifeforms`) over the stored history, draws it ahead of the live curve, and prints when deck 9's carbon dioxide will pass 5,000 ppm at that rate.

### 6. Space Seed

The Enterprise finds a ship of sleepers from the 20th century, wakes their leader, Khan, and tows the ship. Khan takes over the Enterprise and threatens to suffocate Kirk in a decompression chamber. The crew vents anaesthetic gas through the ship. Ship: Enterprise and its crew hub.

| t (s) | Event | Readings | Alerts |
|---|---|---|---|
| 0 | Log: "Sleeper ship found adrift; taken in tow." | `powerTotal` +10; `speed` low | |
| 10 | Someone tries to feed the ship false data: the load test's rogue mode connects to `/ingest` with a wrong key | Refused at the handshake | `ingest-auth` YELLOW |
| 18 | It retries with a stolen key and sends readings out of range, such as `o2_01` = -5 | Every bad sample is refused; nothing reaches the charts or MongoDB | `ingest-invalid` YELLOW |
| 25 | It floods 5,000 samples a second | The token bucket throttles it; the real ship's stream keeps flowing | `ingest-flood` RED |
| 30 | Khan takes engineering and cuts life support deck by deck, starting at the bridge | Deck 1, then 2 and 3, 10 s apart: `press_NN` 101 → 70 kPa over 15 s, `o2_NN` 21 → 15, `temp_NN` 22 → 8 | Per deck: `press` YELLOW then RED, `o2` RED, `temp` YELLOW |
| 40 | On camera: sign in as the communications officer and try to fire phasers | 403 | |
| 45 | The captain in the decompression chamber | Crew 001: `hr` 70 → 140, `rr` 16 → 32 | Crew 001 RED, Sickbay only |
| 60 | Resolution, await: VENT GAS (Bridge, captain); timeout 15 s | Deck 11 crew: `hr` → 55, `nr` → 50 (sedated); life support returns deck by deck; crew 001 recovers | Alerts close as decks recover |
| 75 | Log: "Khan reaches engineering and tries to destroy the ship." | `chamberTemp` 44 → 75, then back | `chamberTemp` > 70 YELLOW |
| 85 | Log: "Khan and his people exiled to Ceti Alpha V." Stand down | | |

## 9. Demo video plan, 3 to 5 minutes

| Time | Segment |
|---|---|
| 0:00 | Power-up and the bridge; the ship turns on the viewscreen |
| 0:20 | Balance of Terror: the ghost on the scope, red alert, phasers |
| 1:20 | The Naked Time: Sickbay as engineer, then as doctor; the grid spreads; cold restart |
| 2:20 | The Doomsday Machine: fleet view, the Constellation lost, its history |
| 3:05 | Mirror, Mirror: the storm, dedup counters on Starfleet Command |
| 3:30 | Stress test numbers, two browsers with different roles, architecture diagram |
| 4:30 | End |

The Tribbles and Space Seed scenarios go in the README with screenshots.
