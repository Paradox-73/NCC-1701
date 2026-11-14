# NCC-1701 Bridge design system

How the app looks, moves and sounds. Every builder follows this file. The telemetry model is in `DOMAIN.md`; the sources behind both are in `RESEARCH.md`.

The reference is the bridge of the starship Enterprise in Star Trek: The Original Series (1966-69). That bridge is a round room: the captain's chair in the middle faces a large viewscreen, and the stations sit around the wall. Each station has a black console of small lit buttons below a row of monitors. The set mixed greys and green-greys with bright orange-red accents on the railing, consoles and doors.

Three rules turn that set into a dashboard:

1. **Monitors carry data, consoles carry light.** Data lives on dark monitor panels in the upper part of each screen. The decorative lit buttons and blinking jewel lights live in a console strip along the bottom. Decorative lights never sit next to a number.
2. **Colour on data means something.** On monitors, yellow means yellow alert and red means red alert, always with a word next to the colour. Healthy readings stay white and blue.
3. **Everything moves, one thing calls for attention.** Background animation runs everywhere but stays dim and slow. Only one thing at a time pulses brightly: red alert, else the newest critical alert, else the live indicator.

The previous project's engine and chart code are reused (see `DOMAIN.md`). Its UX rules carry over: one shared animation-frame loop, React state updated at most four times a second, history and live data merged by sequence number, every colour paired with a word.

## Colour tokens

All tokens are CSS custom properties on `:root`. With Tailwind 4, declare them in `@theme` as `--color-<name>` so `bg-panel`, `text-ink` and so on exist. The canvas and 3D code read the same values from one `theme.js`; change a value in both places.

Contrast ratios below were computed with the WCAG 2 formula against the surface named. Text needs 4.5:1, large text and UI parts 3:1.

### Surfaces

| Token | Hex | Use |
|---|---|---|
| `void` | `#050608` | Page background, and the screen glass inside monitors |
| `console` | `#0B0C0F` | The console strip at the bottom of each screen |
| `panel` | `#14161A` | Monitor bezels, panels, the top bar |
| `raised` | `#1E2127` | Hover, menus, inputs, the selected row |
| `bulkhead` | `#56625E` | The grey-green wall tone of the set: frame edges, dividers, idle bezel lines. Never text. |
| `line` | `#FFFFFF14` | Hairlines |
| `railing` | `#E0522A` | "Enterprise red", the orange-red of the set's railing. A 2 px line under the top bar, the frame of the main viewscreen, the edge of the captain's console. It is decoration and never a status. |

Monitors are a `void` screen inside an 8 px `panel` bezel with a 14 px outer radius, an inner shadow `inset 0 0 24px #000` and a faint scanline overlay: `repeating-linear-gradient(0deg, #FFFFFF05 0 1px, transparent 1px 3px)`.

### Text

| Token | Hex | On `panel` | On `raised` | Use |
|---|---|---|---|---|
| `ink` | `#F1F3F5` | 16.3 | 14.5 | Primary text and live numbers |
| `ink2` | `#B3B9C2` | 9.2 | 8.2 | Secondary text, units |
| `mute` | `#8D95A0` | 6.0 | 5.3 | Labels, axes, timestamps |

### Interaction accent

| Token | Hex | Contrast | Use |
|---|---|---|---|
| `accent` | `#5CB8FF` | 8.4 on `panel` | Focus ring, active station tab, selection, links. Blue, the light of the science station's viewer, so it never reads as an alert. |
| `accent-fill` | `#1C6FC0` | white text 5.1 | The one primary button per view |

### Lit button colours

The jellybean buttons and jewel lights. Each colour has an on value, a dim value for the unlit lens, and a glow. The glow is `box-shadow: 0 0 6px 1px color-mix(in oklab, var(--lit-x) 70%, transparent), inset 0 0 4px #FFFFFF55`.

| Token | On | Dim | Meaning on a real control |
|---|---|---|---|
| `lit-red` | `#FF3B30` | `#4A1410` | Danger: red alert, fire phasers, torpedo |
| `lit-amber` | `#FF9A1F` | `#4A2B08` | Power: warp, impulse, allocation |
| `lit-yellow` | `#FFD83D` | `#4A3D10` | Caution: yellow alert, override |
| `lit-green` | `#3EDB6A` | `#10401E` | Go: engage, ready, open |
| `lit-blue` | `#3FA3FF` | `#0E2C4A` | Information: scan, hail, viewscreen |
| `lit-white` | `#F4EFE2` | `#3A3830` | Navigation: heading, course |

Decorative button grids use all six colours at dim, with a few lit at a time. In yellow alert they turn amber and yellow only; in red alert, red only.

### Status and condition

| Token | Hex | Contrast | Meaning |
|---|---|---|---|
| Nominal | no colour | | A healthy reading shows no colour; its jewel light is a steady dim green |
| `ready` | `#3EDB6A` | 10.1 on `panel` | Positive states with a word: CHARGED, OPEN, LOCKED |
| `warn` | `#FFD23F` | 12.5 on `panel`; `void` text on it 14.0 | Yellow alert and caution |
| `crit` | `#FF4A55` | 5.5 on `panel`, 4.9 on `raised` | Red alert and critical. Small text uses `crit-ink` `#FF7A82` (7.2). Filled chips use `crit-fill` `#C8102E` with white text (5.9). |
| No signal | `mute` on `raised` | 5.3 | A source that stopped sending |

### Division colours

The uniform colours of the show: gold for command, blue for sciences and medical, red for operations. The command fabric was meant to be green and read as gold on camera (`RESEARCH.md`). They mark which division a station or role belongs to, always as a 4 × 16 px pill next to the name, never as a fill.

| Token | Hex | Stations and roles |
|---|---|---|
| `div-command` | `#EDBE4F` | Bridge, Helm; captain |
| `div-science` | `#7AB4E8` | Science, Sickbay; science officer, chief medical officer |
| `div-ops` | `#E8503A` | Engineering, Communications; chief engineer, communications officer |
| `div-fleet` | `#F4EFE2` | Starfleet Command; admin |

### Charts, scopes and heatmaps

- Live series `chart-1` `#7CC4FF`; a second series `chart-2` `#F4EFE2`. History from MongoDB draws in `mute` grey, with a small "live from here" tick where live data starts.
- Normal band: a fill of `#FFFFFF0A` between the channel's normal limits. Warn and critical limits are dashed lines in `warn` and `crit`.
- Sweep scope phosphor `scope` `#58C4FF`, with a fading trail.
- Crew biosign heatmap, by distance from the person's own baseline: under 1 standard deviation `raised`, 1-2 `#2F6FAE`, 2-3 `warn`, over 3 `crit`, no signal `void` with a diagonal hatch.

### Condition modes

`<html data-condition="normal | yellow | red">` drives the whole look. The server owns the ship's condition; the client only reflects it.

| | Yellow alert | Red alert |
|---|---|---|
| Alert bars | 8 px bars at the top and bottom edge of the viewport in `warn`, steady | Same bars in `#FF2A3D`, pulsing once a second |
| Surfaces | Unchanged | `void` becomes `#0A0204`, `panel` `#1A0B0E`. Text contrast stays above 5.8. |
| Console grids | Amber and yellow only | Red only, blinking in step |
| Viewscreen frame | `warn` | `#FF2A3D` |
| Top bar | YELLOW ALERT in `warn` | RED ALERT in `crit` |
| Sound | Two-tone alert once | Red alert sound twice, then silence |

The accent stays blue in every mode, so keyboard focus is always visible.

## Typography

All three families are free under the SIL Open Font License 1.1 and are self-hosted from `@fontsource` packages, so the app needs no font request at run time. Licences were checked in each family's `METADATA.pb` in the `google/fonts` repository and in the npm package metadata.

| Family | Weights | Package | Licence, designer | Use |
|---|---|---|---|---|
| Michroma | 400 only | `@fontsource/michroma` 5.3.0 | OFL 1.1, Vernon Adams | Station titles, console button labels, the condition banner, viewscreen captions. Uppercase, letter spacing 0.08em, 11 px or larger. Wide letters, so never for numbers or long text. |
| Space Grotesk | 300-700, variable | `@fontsource-variable/space-grotesk` 5.3.0 | OFL 1.1, Florian Karsten | All interface text: labels, menus, buttons, body, the log |
| Space Mono | 400, 700 | `@fontsource/space-mono` 5.3.0 | OFL 1.1, Colophon Foundry | Every live number, units, stardates, key caps. Monospaced, so changing digits do not shift. |

Scale in px: 11, 12, 14, 16, 20, 28, 40, 64. Body text is 14. Labels are 12 Space Grotesk 500 in `mute`. Michroma labels are uppercase and at most three words; Space Grotesk text is sentence case. The hero number on a monitor is Space Mono 700 at 28 or 40; the warp factor on the helm is 64.

An optional TOS-style display face for the wordmark and the ship registries only, if its licence allows: Final Frontier Old Style by Allen R. Walden, based on the show's title lettering, or Airborne by Charles Casimiro Design, made for TOS-era hull lettering. Their FontSpace pages blocked my fetcher, so their licences are not verified here. Read the licence file inside the download before adding either, and credit it.

## Space, shape and layout frame

- Spacing steps: 4, 8, 12, 16, 24, 32, 48.
- Radius: 3 px buttons and chips, the shape of the jellybean lenses; 10 px panels; 14 px monitors, the rounded screens of the set; full round for jewels.
- Touch layouts, narrower than 1024 px or with a coarse pointer, give every control a 44 px target.
- No sideways page scroll at 390, 768, 1024, 1280 or 1440 px.

Every station screen uses the same frame:

```
+------------------------------------------------------------------------+
| top bar: wordmark | station tabs | condition | stardate | rate | sound | user |
+================================ railing (2 px, railing colour) =========+
|                                                                        |
|   monitor area: the station's own grid of monitors (12 columns)        |
|                                                                        |
+------------------------------------------------------------------------+
| console strip, 112 px: real controls (lit buttons with key caps) |      |
|                        decorative button grid | jewel row         |      |
+------------------------------------------------------------------------+
```

Below 1024 px the monitors stack in one column, the decorative grid hides, and the console strip becomes a bottom bar with the station's four main controls. On phones the station tabs move into a menu.

## Components

| Component | What it is | Notes |
|---|---|---|
| `TopBar` | Wordmark, station tabs, condition lamp, stardate clock, live readings per second, sound toggle, user and role | Stardate comes from `DOMAIN.md`. Sticky. |
| `StationTab` | Division pill and a Michroma label | Active tab: `accent` underline sitting on the railing line. Tabs the role cannot open are hidden. |
| `ConditionLamp` | NORMAL, YELLOW ALERT or RED ALERT as a lamp and a word | The captain can click it to change condition. |
| `Monitor` | A rounded screen in a bezel with a title strip | Slots: chart, readout, scope, list. States: power-on, live, no signal, restricted. No signal shows a low-resolution static pattern and the words NO SIGNAL. Restricted shows a lock and "Medical records: CMO and captain only". |
| `Readout` | Label, big number, unit, change arrow, 60 s sparkline with the normal band | The number ticks to its new value. Colour appears only past a limit. |
| `LitButton` | A real control, a translucent lit rectangle with a Michroma label and a key cap | A real `<button>` with `aria-pressed` where it toggles. States: dim, lit, blinking while the server has not yet acknowledged the command, pressed. Colour from the lit-button table. |
| `ButtonGrid` | Decorative rows of jellybeans that light up in random patterns | `aria-hidden`. Pattern seeded per grid. CSS animations only, no JavaScript per frame. |
| `Jewel` | A small round faceted lamp, one per system | Steady dim green when nominal, slow blink in `warn`, fast blink in `crit`, dark with no signal. Always has a text label or `aria-label`. |
| `SweepScope` | Round sensor scope with a rotating sweep and contact blips that fade | Canvas. One turn every 4 s. A cloaked contact shows as a faint, broken blip. |
| `BarGauge` | Vertical segmented bar with the normal band and limit ticks | Nacelle output, shield quadrants, deck oxygen. |
| `ArcGauge` | A 240° arc with a needle | Warp factor 0-9 with integer ticks; reactor output. The needle eases to each new value. |
| `ShieldRing` | Top-down silhouette of the ship with four arcs: fore, aft, port, starboard | Each arc coloured by strength; a hit makes the arc flare white for 300 ms. |
| `DeckStack` | Side view of the ship cut into deck bands | Each band coloured by its life-support status. Click a deck for oxygen, carbon dioxide, temperature, pressure and gravity. |
| `CrewGrid` | 430 small cells grouped by deck, coloured by biosign deviation | Canvas. Medical and captain only. Hover or tap shows the crew member. |
| `BiobedPanel` | Vertical scales with moving pointer arrows for heart rate, respiration, temperature, blood pressure and neural activity | Echoes the sickbay bed displays of the show. A dot pulses at the live heart rate. |
| `Viewscreen` | The main viewer, 3D with a 2D fallback | Frame in `railing` colour with a caption strip such as `MAIN VIEWER · FORWARD · ×1`. Modes in "At the helm". |
| `CommsPanel` | Subspace channels with carrier strength bars, delay and loss, the hailing lamp, the message log | "Hailing frequencies open" lights green. |
| `CaptainsLog` | Feed of alerts, commands and scenario steps, each as a log line with a stardate | Newest first, filter by severity, acknowledge button. |
| `AlertBars` | The condition bars at the viewport edges | See Condition modes. |
| `FleetMap` | 2D sector plot of the task force with headings, short trails and a condition ring per ship | Canvas, in the shared animation loop. |
| `ShipCard` | One ship of the task force: registry, name, condition, warp, weakest shield, open alerts, link state | Click opens that ship's bridge. |
| `Turbolift` | Station change, and the station picker on `Ctrl+K` | The transition is in Motion. |
| `ScenarioConsole` | Picks a TOS episode scenario, starts and stops it, shows its timeline with step markers | Captain and admin only. |
| `KeyCap` | A small key label on a button | Space Mono 10 px in a 1 px `line` box. |

## Motion

Durations: 80 ms hover; 120 ms press and light on; 200 ms toggles and chips; 280 ms panels and menus; 450 ms station change; 600-900 ms power-up sequences; 1000 ms the red alert pulse period. Entrances use `cubic-bezier(0.2, 0, 0, 1)`, exits `cubic-bezier(0.4, 0, 1, 1)`. Lights switch with `steps(1)` so they snap on and off like lamps. Only `transform` and `opacity` animate in CSS. Gauges, scopes, maps, number ticks and the starfield run in the one shared animation-frame loop.

Two tiers of animation:

- **Ambient**, many at once, dim and slow: button grids twinkle (each lamp changes every 1.5 to 6 s), jewels idle, the scope sweeps, the starfield drifts, the live dot pings. All pause while the tab is hidden.
- **Attention**, one at a time and bright: red alert bars, else the newest critical alert, else the live dot. `data-attention` on the root names which one owns it.

| Moment | What happens |
|---|---|
| Power-up, once per session | Console grids light up left to right over 600 ms. Monitors switch on like a tube screen: a bright horizontal line opens to full height in 240 ms. The viewscreen fades in on the starfield. Any key or click skips it. |
| Station change | A light runs up the right edge like the turbolift indicator; the old station slides up 40 px and fades, the new one rises from below. 450 ms. |
| New number | Ticks to the new value in 240 ms. Crossing a limit flashes the reading once. |
| Monitor content change | Brief tube flicker: opacity 1, 0.6, 1 over 120 ms. |
| Button press | The lens flashes to a white core for 80 ms, then its colour. |
| Command sent | The button blinks twice a second until the server acknowledges, then holds steady; the log shows "Warp factor 6, aye" with the round trip in ms. |
| Warp engage | The starfield stretches into streaks over 800 ms; the warp needle sweeps to the new factor. |
| Shield hit | The quadrant arc flares; the 3D shield bubble ripples from the hit point; the viewscreen shakes 2 px for 200 ms. |
| Alert raised | The log row slides in from the top and pulses three times; the system's jewel switches to fast blink. |
| Yellow alert | Bars slide in over 240 ms and stay; console grids shift to amber and yellow. |
| Red alert | Bars pulse at 1 Hz; surfaces tint red; console grids blink red in step; the viewscreen frame turns red; RED ALERT in the top bar. |
| Stand down | Bars slide out; CONDITION NORMAL shows for 1 s in `ready`. |
| Login | The ship turns slowly on the viewscreen behind the "Identify" console with one lit button per demo role. |

Flash safety: nothing flashes faster than twice a second. WCAG 2.3.1 sets the limit at three flashes per second. The red alert pulse is a smooth 1 Hz ramp on edge bars and a light tint, not a full-screen strobe.

Reduced motion, from `prefers-reduced-motion: reduce` or the Help toggle (`data-motion="reduce"`): no twinkle, no sweep (the scope redraws a still wedge every 2 s), no streaks (warp shows on the gauge), no camera moves or shake, red alert bars steady, station change is a 150 ms crossfade, numbers jump to the new value. Colour changes stay, so no information is lost. The 3D canvas renders on demand, only when data changes.

## Sound

Muted by default. The speaker button in the top bar, or `M`, turns sound on; that click is the user gesture browsers require before audio can play. Sound runs on the Web Audio API: one `AudioContext` created on first unmute, every clip fetched and decoded into an `AudioBuffer` at that moment, one master gain at -12 dB, at most 4 voices at once, and a cooldown per cue so a 50 Hz stream never machine-guns beeps. The choice is remembered in the browser.

The team lead approved original-series sound effects with credits (see Assets and credits). The clips below are from the TrekCore audio archive; sizes are the downloaded files, before trimming. Trim each to the length given, mono, 64 kbps:

```
ffmpeg -i in.mp3 -ss 0 -t 2 -ac 1 -b:a 64k client/public/sfx/<cue>.mp3
```

Budget: 1.5 MB for all cues together after trimming. If a clip cannot be used, the Web Audio fallback on the right is a few lines of oscillator code.

| Cue | When | Clip from `https://www.trekcore.com/audio/` | Size | Trim | Fallback synth |
|---|---|---|---|---|---|
| `press` | Any lit button | `toscomputer/tos_com_beep_1.mp3` | 80 KB | 0.3 s | Sine 1.2 kHz, 40 ms |
| `ack` | Alert acknowledged, command acknowledged | `toscomputer/tos_com_beep_3.mp3` | 78 KB | 0.3 s | Sine 1.6 kHz then 1.2 kHz |
| `console` | Idle console chatter every 20-40 s on the bridge | `toscomputer/sequences/tos_computerbeeps.mp3` | 279 KB | 2 s | 4 random square blips, 1-3 kHz |
| `hail` | Hailing frequencies open | `toscomputer/tos_hailing.mp3` | 91 KB | whole | Sine glide 800 to 1600 Hz, 300 ms |
| `intercom` | Announcement, scenario step | `toscomputer/tos_intercom_whistle.mp3` | 57 KB | whole | Two sine notes |
| `yellow` | Yellow alert | `redalertandklaxons/tos_klaxon.mp3` | 1.08 MB | first hoot, about 1 s | Two-tone 660 and 880 Hz |
| `red` | Red alert, played twice | `redalertandklaxons/tos_red_alert.mp3` | 1.72 MB | 2 s | Sawtooth sweep 440 to 880 Hz through a low-pass filter |
| `phaser` | Phasers fire | `weapons/tos_ship_phaser_1.mp3` | 150 KB | whole | Noise burst through a falling band-pass |
| `torpedo` | Photon torpedo | `weapons/tos_photon_torpedo.mp3` | 310 KB | 1.5 s | Low sine thump with a pitch drop |
| `transport` | Transporter cycle | `transporters/tos_transporter1_top.mp3` | 1.27 MB | 2.5 s | Shimmering detuned sines |
| `transport-fault` | Transporter malfunction | `transporters/tos_transportertrouble_clean.mp3` | 1.23 MB | 2.5 s | Same, with a wobbling pitch |
| `station` | Station change | `doors/tos_swoosh_2.mp3` | 150 KB | 0.6 s | Filtered noise swell |
| `lift` | Login and power-up | `turbolift/tos_turbolift.mp3` | 598 KB | 1.5 s | Rising filtered noise |
| `warp` | Warp engage | `warp/tos_flyby_1.mp3` | 150 KB | whole | Noise with a rising low-pass |
| `chirp` | Incoming subspace message | `communicator/tos_chirp_1.mp3` | 150 KB | whole | Two quick square blips |
| `heartbeat` | Sickbay, selected crew member, at their live heart rate | `medicaldevices/tos_heartbeats_1.mp3` | 982 KB | one beat, about 0.4 s | Sine 900 to 500 Hz, 120 ms |
| `reactor` | Engine cold restart | `other/tos_reactor_up_down.mp3` | 4.6 MB | 3 s | Rising sawtooth through a sweeping filter |
| `ambience` | Optional bridge background loop, its own toggle, off by default | `background/tos_bridge_2.mp3` | 9.2 MB | a 20 s loop at 48 kbps | none |

## Stations

Seven screens plus login. A role sees only the station tabs it may open; the server enforces the same rules (`DOMAIN.md`, Roles). Each wireframe shows the monitor area; the console strip lists its real controls.

### Bridge, the captain's chair (`/bridge`)

Everyone can open it; tiles a role may not see show as restricted.

```
+---------------+-------------------------------------+---------------+
| ENGINEERING   |                                     | SCIENCE       |
| warp, reactor |                                     | contacts      |
+---------------+         MAIN VIEWSCREEN (3D)        +---------------+
| LIFE SUPPORT  |                                     | COMMS         |
| worst deck    |                                     | channels      |
+---------------+-------------------+-----------------+---------------+
| HELM: warp arc, heading, speed    | CAPTAIN'S LOG: alerts and steps |
+-----------------------------------+---------------------------------+
| SICKBAY: crew counts (CMO and captain) | TASK FORCE: 3 jewels       |
+--------------------------------------------------------------------+
```

Each side tile is a small monitor with one number, a sparkline and a jewel; clicking it takes the turbolift to that station. Console strip, the arms of the captain's chair: RED ALERT, YELLOW ALERT, STAND DOWN, HAIL, VIEWER mode, SHIELDS, and the scenario button.

### Helm and navigation (`/helm`)

The helm also runs the weapons, as on the show. The captain gives the orders; other roles see it read-only.

```
+------------------------------------------+-------------------------+
| NAVIGATION PLOT: course line, heading,   | WARP FACTOR arc, 64 px  |
| own ship, task force, sensor contacts    | IMPULSE bar             |
|                                          | SPEED, HEADING, POSITION|
+-------------------+----------------------+-------------------------+
| SHIELD RING       | PHASER BANKS: charge | PHOTON TORPEDOES: tubes |
| four quadrants    | bars, fore and aft   | loaded, count left      |
+-------------------+----------------------+-------------------------+
```

Console strip: WARP −, WARP +, FULL IMPULSE, ALL STOP, HEADING ◀ ▶, SHIELDS, PHASERS, TORPEDO.

### Engineering (`/engineering`)

```
+-------------------+--------------------+----------------------------+
| REACTION CHAMBER  | DILITHIUM          | NACELLES: port and         |
| intermix column,  | efficiency arc     | starboard output bars      |
| glowing           | crystal temp       | IMPULSE REACTOR            |
+-------------------+--------------------+----------------------------+
| POWER ALLOCATION: stacked bar: warp, shields, weapons, life support |
+-------------------------------+-------------------------------------+
| DECK STACK: life support and  | SELECTED DECK: O2, CO2, temp,       |
| gravity by deck               | pressure, gravity, history and live |
+-------------------------------+-------------------------------------+
```

Console strip: allocation presets (CRUISE, COMBAT, EMERGENCY), EMERGENCY POWER, COLD RESTART when a scenario asks for it.

### Science (`/science`)

```
+-----------------------------+--------------------------------------+
| SENSOR SCOPE, large         | CONTACTS: bearing, range, signature, |
|                             | confidence                           |
+---------------+-------------+--------------------------------------+
| VIEWER: the   | SENSOR ARRAYS: | ANOMALIES: channel, z-score,      |
| hooded scope, | health of each | since when                        |
| blue spectrum | array          |                                   |
+---------------+----------------+-----------------------------------+
```

Console strip: SCAN, FOCUS CONTACT, LONG RANGE, SHORT RANGE.

### Communications (`/comms`)

```
+----------------------------------+---------------------------------+
| SUBSPACE CHANNELS: carrier bars, | HAIL: task force ships and      |
| delay, loss per channel          | Starfleet Command, lamp per link|
+----------------------------------+---------------------------------+
| SIGNAL SCOPE: carrier waveform   | MESSAGE LOG: priority, from,    |
|                                  | text                            |
+----------------------------------+---------------------------------+
```

Console strip: HAIL, CLOSE CHANNEL, PRIORITY ONE, INTERCOM.

### Sickbay (`/sickbay`), chief medical officer and captain only

```
+-------------------------------------------+------------------------+
| CREW GRID: 430 cells by deck              | WATCH LIST: crew over  |
|                                           | 2 standard deviations  |
+---------------------+---------------------+------------------------+
| BIOBED: selected    | VITAL TRENDS: last 10 minutes, history and   |
| crew member         | live                                         |
+---------------------+----------------------------------------------+
```

Console strip: QUARANTINE DECK, CLEAR WATCH, SEDATIVE (scenario only).

### Starfleet Command (`/fleet`), admin

```
+-------------------------------------------+------------------------+
| SECTOR MAP: task force ships, headings,   | SHIP CARDS, one per    |
| conditions, comm links                    | ship                   |
+---------------------+---------------------+------------------------+
| FLEET LOG: alerts   | SYSTEM: readings/s, clients, latency p50/p95/ |
| from every ship     | p99, write queue, rejected events             |
+---------------------+----------------------------------------------+
| SCENARIOS: launcher and timeline                                   |
+--------------------------------------------------------------------+
```

The admin sees crew health only as counts per ship, never individual biosigns.

### Login (`/login`)

The 3D ship turns slowly behind an "Identify" console: one lit button per demo account, coloured by division, plus a username and password form.

## At the helm: keyboard

Shortcuts are ignored while the focus is in a text field. Commands go to the server, which validates them, rate-limits them, checks the role, and passes them to the simulator; the button blinks until the acknowledgement comes back. `?` opens this table in the app.

| Key | Action | Who |
|---|---|---|
| `0`-`9` | Set warp factor; `0` drops to impulse | Captain |
| `↑` `↓` | Warp factor up or down by one | Captain |
| `I` | Full impulse | Captain |
| `X` | All stop | Captain |
| `←` `→` | Heading 5° to port or starboard | Captain |
| `Shift`+`S` | Shields up or down | Captain |
| `P` | Fire phasers at the locked contact | Captain |
| `Shift`+`P` | Fire a photon torpedo | Captain |
| `R` | Red alert | Captain |
| `Y` | Yellow alert | Captain |
| `N` | Stand down to normal | Captain |
| `H` | Open or close hailing frequencies | Captain, communications officer |
| `V` | Next viewscreen mode: forward, aft, tactical, magnify | Everyone, local view only |
| `+` `-` | Magnification ×1, ×2, ×4, ×8 | Everyone |
| `G` then `B` `H` `E` `S` `C` `M` `F` | Go to Bridge, Helm, Engineering, Science, Comms, Medical, Fleet | Stations the role may open |
| `Ctrl`+`K` | Turbolift: station picker | Everyone |
| `A` | Acknowledge the newest alert | Roles that can see it |
| `M` | Sound on or off | Everyone |
| `?` | Shortcut sheet | Everyone |
| `Esc` | Close overlay | Everyone |

Viewscreen modes: FORWARD shows space ahead, the planet in orbit scenarios and contacts, without our own ship, as on the show. AFT reverses the camera. TACTICAL is an outside chase view of our ship with the shield bubble and contacts. MAGNIFY narrows the field of view on the locked contact or the planet.

## 3D plan

Stack: `three` 0.187.0, `@react-three/fiber` 9.8.2, `@react-three/drei` 10.7.9. Fiber 9 needs React 19 below 19.4; the previous client used React 19, so keep it inside that range.

### The ship model

Primary: "USS Enterprise (TOS 1966)" by AleixoAlonso on Sketchfab, CC Attribution, 21,126 triangles, 1.16 MB as GLB, 548 KB as glTF. https://sketchfab.com/3d-models/uss-enterprise-tos-1966-d48eeab56cc3472c99c1780202b7a5f8

Backups, both CC Attribution:
- "Classic U.S.S. Enterprise from Star Trek TOS" by Major Stress, 13,899 triangles, 8.9 MB as GLB because of its textures. https://sketchfab.com/3d-models/classic-uss-enterprise-from-star-trek-tos-acfe41446dc149848559e5542f59cef9
- "USS Enterprise NCC-1701" by Terranimperial, 46,253 triangles, 3.3 MB as GLB. https://sketchfab.com/3d-models/uss-enterprise-ncc-1701-1201a33639ea472885e68a2490e19de6

Pipeline: download the glTF, then run `npx gltfjsx model.glb --transform`. It writes a compressed `model-transformed.glb` and a React component. Target 800 KB or less. `--transform` uses Draco compression, and drei's `useGLTF` fetches the Draco decoder from a CDN by default; copy the decoder into `client/public/draco/` and call `useGLTF.setDecoderPath('/draco/')` so the demo works offline.

The task-force ships are the same Constitution-class model with their own registry label (a drei `<Text>` or a canvas sprite) and their own condition ring. Optional contacts, both CC Attribution: "Classic Romulan Bird of Prey from ST:TOS" by Major Stress, 4,389 triangles, 4.5 MB as GLB before compression, for the Balance of Terror scenario (https://sketchfab.com/3d-models/classic-romulan-bird-of-prey-from-sttos-bb741e47650c4571b747c947567a5c6f); without it, a contact is a glowing sprite.

If no model can be used, build the silhouette from primitives: a flattened cylinder for the saucer, a small dome for the bridge, a tapered cylinder for the engineering hull, a cone with an emissive copper disc for the deflector dish, two angled boxes for the pylons, and two cylinders for the nacelles with emissive red-orange spheres at the front. About 1,000 triangles.

### Scene parts

- **Starfield.** drei `<Stars>` at impulse. At warp, a `WarpStreaks` component: 2,000 line segments in one `LineSegments` geometry, moved toward the camera every frame at a speed that grows with the square of the warp factor and wrapped around. Streak length grows with the warp factor. It blends in over 800 ms.
- **Planet in orbit.** A 64-segment sphere with a canvas-generated banded texture and an atmosphere shell: a slightly larger sphere drawn from the inside with additive blending. Its size on screen follows the orbit altitude channel, so a decaying orbit makes the planet grow.
- **Shield bubble.** An ellipsoid around the ship with a fresnel shader: invisible while nothing hits it. A hit sends the hit direction and time to the shader, which draws a ring spreading from the hit point for 600 ms. Its colour follows the weakest quadrant: blue, then `warn`, then `crit`.
- **Weapons.** Phaser: a beam from the saucer to the target for 300 ms, additive, `#FF6A3D`. Torpedo: a flickering glowing sprite that flies for 1.2 s.
- **Contacts.** The Romulan model or a sprite. A cloaked ship flickers between opacity 0 and 0.15.

### Loading and fallback

- `const Viewscreen3D = lazy(() => import('./viewscreen/Viewscreen3D.jsx'))`, rendered inside `<Suspense fallback={<Viewscreen2D />}>` with an error boundary that also falls back to `Viewscreen2D`.
- 3D loads only when WebGL works, `navigator.connection?.saveData` is not set, and the device reports more than 2 cores. A settings toggle turns it off.
- `Viewscreen2D` is a canvas: the same starfield and streaks in 2D, and the ship as an SVG silhouette in TACTICAL mode. It is also what screenshots and slow laptops get, so it must look finished.
- One WebGL canvas only, on the viewscreen; fleet cards and the login use the same canvas or 2D drawings. `dpr={[1, 1.5]}`; rendering stops while the viewscreen is off screen or the tab is hidden.
- Report the size of the 3D chunk from `vite build` in the performance notes; it must stay out of the first page load.

## Assets and credits

Policy from the team lead: this is an internal college hackathon, so existing Star Trek assets are allowed, as long as every one is credited with source, author and licence where stated. Prefer assets with an explicit free or Creative Commons licence and small files. The problem statement asks the same: "Proper credit must be given when using external code or design resources."

### Recommended assets

| Kind | Asset | Author, source | Licence | Size | Use |
|---|---|---|---|---|---|
| 3D | USS Enterprise (TOS 1966) | AleixoAlonso, Sketchfab (link above) | CC Attribution | 1.16 MB GLB | Own ship and task force |
| 3D, optional | Classic Romulan Bird of Prey from ST:TOS | Major Stress, Sketchfab (link above) | CC Attribution | 4.5 MB GLB, compress | Balance of Terror contact |
| Font | Michroma, Space Grotesk, Space Mono | Vernon Adams; Florian Karsten; Colophon Foundry, via Google Fonts and `@fontsource` | OFL 1.1 | latin subset only | All text |
| Font, optional | Final Frontier Old Style or Airborne | Allen R. Walden; Charles Casimiro Design, FontSpace | Not verified, read the licence in the download | small | Wordmark and registries only |
| Sound | The cues in the Sound table | TrekCore audio archive, https://www.trekcore.com/audio/; original audio from Star Trek: The Original Series | No licence stated on the page; audio © CBS Studios | 1.5 MB after trimming | Sound cues |
| Insignia | Starfleet delta: command star, sciences, operations, medical cross | Redrawn by us as SVG from the show's design | Design © CBS Studios; our drawing | under 2 KB | Role badges, login buttons, wordmark |

No free-licensed SVG of the original-series delta turned up in the search, so draw it: one delta path plus a small inner emblem per division. Command star for the captain, sciences emblem for the science officer, sciences emblem with a red cross for the chief medical officer, operations emblem for the chief engineer and communications officer, a plain delta for Starfleet Command.

Avoid models marked NoDerivs, such as the very large ZEOCMF models: we must compress and modify every model, which NoDerivs forbids. Avoid ships from other eras, such as the 2009 film version or the refit from the 1979 film, and the 1980s-90s LCARS screen style. They break the 1960s look.

### Attribution rules

1. Every third-party file gets a row in the README's Credits section: repo path, title, author, source URL, licence with its URL, and what we changed ("compressed with gltfjsx", "trimmed to 2 s, mono").
2. CC Attribution requires the title, the author, the source, the licence and a note of changes. Copy the exact licence name from the model's Sketchfab page when downloading.
3. The app has a Credits dialog in the help menu with the same list.
4. Libraries are credited in the README as the problem statement asks: React, Express, Socket.IO, Mongoose, three.js, react-three-fiber, drei, uPlot, the `@fontsource` packages.

### Fan disclaimer for the README

Adapted from the disclaimer the franchise's own fan-production guidelines require (https://www.startrek.com/fan-films):

> NCC-1701 Bridge is a non-commercial fan project made for a student hackathon. Star Trek and all related marks, logos and characters are owned by CBS Studios Inc. This project is not endorsed by, sponsored by, or affiliated with CBS, Paramount Pictures or any Star Trek franchise. Third-party assets are listed with their authors and licences under Credits.

## What to cut if time runs short

Cut from the top of this list first:

1. The primitive-built ship, if the Sketchfab model works.
2. The Romulan model; use the contact sprite.
3. The bridge ambience loop.
4. The planet's atmosphere shell; keep a plain sphere.
5. The turbolift light on station change; keep the crossfade.
6. The static pattern on NO SIGNAL; keep the words.
7. The hooded viewer monitor on Science.

Never cut: red alert mode, the viewscreen with warp streaks and its 2D fallback, lit buttons that really command the simulator, the crew grid with its access rule, the shield ring, the captain's log, the warp, red alert and hail shortcuts, reduced motion, and the credits list.
