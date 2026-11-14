# NCC-1701 Bridge research notes

The facts behind `DESIGN.md` and `DOMAIN.md`, with sources. "Read" means the page was opened and the fact read on it. "Search summary" means the fact came from a search result whose page could not be opened. "General knowledge" means no page was checked; treat those as unconfirmed.

Memory Alpha, the main fan wiki, answered every automated request during this research with HTTP 402, so no fact here comes from it. FontSpace and Trekipedia answered 403. Anyone with a browser can check the Memory Alpha pages for the six episodes before recording the video.

## The bridge set

- Pato Guzman's team made the first bridge design in 1964; Matt Jefferies, his assistant, designed the ship and several sets. The bridge was monochrome in the first pilot and was repainted for the second pilot because colour television was spreading. For the series it was rebuilt in modules so sections could be pulled out for the camera. Its readouts and lights ran on electronics that needed costly air conditioning. The chairs, by Burke of Dallas, resembled Eero Saarinen's tulip chair. Read: https://en.wikipedia.org/wiki/USS_Enterprise_(NCC-1701)
- When the set was recreated for Star Trek: Discovery, the "jellybean" buttons were reproductions in "the same exact size and color" as the originals. "Enterprise red" was on the railings, consoles and doors, a "reddy-orange" that looked orange or red depending on the lighting. Around the command area the 1966 set had "bright orange-red accents" with "greys and greens". The chairs were black and blue; the captain's chair black leather with some wood. The set used gobo lighting, grids that cast patterned shadows. Sulu's and Spock's eye scanners, Uhura's station layout and the turbolift's moving indicator light were all reproduced. Read: https://blog.trekcore.com/?p=43327
- The bridge is a round room with the captain's chair in the middle facing the main viewscreen, the stations around the wall, and the bridge on deck 1. General knowledge, consistent with the search summary for "original series Enterprise bridge layout".

Used for: the palette (`railing`, `bulkhead`, black consoles, lit buttons), the round 14 px monitors, the station frame, the turbolift light on station change.

## Bridge consoles

"Seen" means the photo or screencap was downloaded and looked at; the files are in `mernify/design/ncc/consoles/refs/`, outside this repository.

Sources:

1. The original helm and navigation console, restored for the Museum of Pop Culture: 11 photos and the restorers' notes. Read and seen: https://www.startrek.com/news/restored-tos-navigation-helm-console-ready-for-spaceflight
2. Original props at the Henry Ford Museum, photos by Joe Ross, CC BY-SA 2.0. Seen: the helm console with Kirk's chair, https://commons.wikimedia.org/wiki/File:Captain%27s_chair_and_Uniform_with_the_original_helm_and_navigation_console_-_Star_Trek_-_Exploring_New_Worlds_Exhibit_at_the_Henry_Ford_Museum.jpg, and four panels the museum labels "Bridge computer console", "Enterprise self-destruct panel", "Transmitter console" and "Bridge control panels", https://commons.wikimedia.org/wiki/File:Enterprise_bridge_consoles_and_panels_-_Star_Trek_-_Exploring_New_Worlds_Exhibit_at_the_Henry_Ford_Museum.jpg
3. Kirk's chair, photo by Theresa Arzadon-Labajo, CC BY 2.0. Seen: https://commons.wikimedia.org/wiki/File:Icons_of_Science_Fiction_-_Star_Trek,_Captain_Kirk%27s_chair_(15631843099).jpg
4. The licensed recreation of the Desilu stage 9 sets in Ticonderoga, NY. Seen: the bridge panorama by Mobilus In Mobili, CC BY-SA 2.0, https://commons.wikimedia.org/wiki/File:USS_Enterprise_NCC-1701_Bridge_Set.jpg; main engineering, https://commons.wikimedia.org/wiki/File:USS_Enterprise_NCC-1701_Main_Engineering_Set.jpeg; the TrekNews gallery (photos 10-18, 22, 23, 42, 89), https://treknews.net/2019/11/18/gallery-star-trek-original-series-set-tour/
5. Screencaps. Seen: TrekCore's Blu-ray captures of "The Corbomite Maneuver" (frames 7, 13, 22, 106, 160, 247, 250, 286), https://tos.trekcore.com/gallery/thumbnails.php?album=186; Ex Astris Scientia's bridge, engineering and sickbay captures, http://www.ex-astris-scientia.org/articles/enterprise-issues.htm and http://www.ex-astris-scientia.org/inconsistencies/monitors_tos.htm
6. Franz Joseph, *Star Fleet Technical Manual* (1975), the scan's OCR text on the Internet Archive. Read: https://archive.org/details/star-trek-star-fleet-technical-manual
7. The sickbay bed monitor. Read: https://wrathofdhanprops.blogspot.com/2013/09/dammit-jim-imadoctornotamagician-how.html. Seen: a recreation on a small screen, https://hackaday.com/2019/07/05/an-arduino-sickbay-display-worthy-of-the-enterprise/

What a station looks like, top to bottom (seen in sources 4 and 5):

- **Wall.** Grey, with a red line where it meets the ceiling cove. Above each station the wall steps back into a darker rounded-rectangle bay that holds one or two screens. Each screen has rounded corners and a thin pale frame. On the show they carry soft colour fields and plain shapes, such as the green and blue swirls in "The Corbomite Maneuver"; the recreation adds star fields, grids and small captions along the bottom edge.
- **Readout band.** Under the bays runs a black band of small square backlit windows: rows of coloured rectangles in yellow, green, orange and red, bar patterns, and a few yellow graph-paper panels crossed by a red line. The museum's original "Bridge computer console" panel is the same kind of thing: columns of copper and yellow-green gel rectangles on black (source 2).
- **Desk.** A sloped near-black top with fan-shaped black plates of "jellybean" buttons: faceted translucent blocks and round domed lenses in red, amber, yellow, green, blue and clear. A red stripe runs along the desk's front edge. Below it, a grey kick panel with backlit perforated grilles in pink, amber, white and green.

Station by station:

- **Helm and navigation.** One long console in front of the captain's chair: black top, red front, pale grey trim. It is wood, repainted every season with a black coat between colours to stop light leaking through (source 1). In the middle sits the astrogator: a pale grey housing with a round backlit plotting disc, a polar grid of rings and rays, a yellow centre disc and red and green course lines (sources 1, 2), with a small translucent trapezoid lamp on top that is red in frame 13. The Technical Manual names its parts "view plate of cloud chamber", "coordinate grid system" and "ship's log and chronometer", and calls the bright spot that marks the destination the "flying point". The Sulu scope is a grey viewer on a folding arm that rises out of the helm side with a lit green or blue screen (sources 1, 2). The navigation side has the targeting scanner: an amber fan-shaped grid with a crosshair ring and red and green markers, the only 1960s graphic that survived on the console (source 1; the recreation in TrekNews photo 15).
- **Science.** Spock bends into a hooded viewer that throws blue light onto his face (frame 247). In the recreation it is a pale grey wedge-shaped hood with a blue screen at its mouth (source 4, panorama). The Technical Manual calls the station "command intelligence" with a "library computer control panel" and a "ship's sensors and scanners complex control panel".
- **Communications.** Uhura works a black panel of small gem buttons under rows of amber, green and red indicator windows, one hand at a silver ear receiver with a ribbed end (frames 160, 286). The Technical Manual files it as the "bridge ear receiver" in the communications station section.
- **Engineering.** The main engineering control panel is pale grey with black sub-panels drawn as line schematics; its black desk carries slide levers with red knobs, yellow toggles and striped colour chips, and has a red front edge (TrekNews photo 22). Behind it the engine room's forced-perspective grille glows red, orange and magenta.
- **Sickbay.** Above each bed hangs an angled grey box with a black screen: six vertical red scales, each with a lit segment and a small triangle pointer that moves with the patient, labels underneath (temperature, brain, lungs, cell rate, two blood readings), and two round lamps in the middle that flash for pulse and respiration (source 7; seen in "The Changeling" and TrekNews photo 42).
- **Captain's chair.** Black leather seat on a grey box base and a round pedestal, walnut arm caps. The arm boxes carry small black plates of buttons: white push buttons on one side, coloured gem buttons and a small square intercom grille on the other (sources 2, 3).

Used for: the station frame in `DESIGN.md` (wall bays, readout band, jellybean desk, red desk edge) and each station's signature piece: the astrogator and targeting scanner on Helm, the hooded viewer on Science, the ear receiver and switch panel on Communications, the readout wall and slide levers on Engineering, the bed monitor on Sickbay.

## Uniforms and insignia

- Command wore gold, sciences and medical blue, operations, engineering and security red. "The gold uniforms were actually intended to be green, but read on camera as the color that we know today." Read: https://www.denofgeek.com/tv/star-trek-uniform-colors-change-original-series-next-generation/
- In the series the delta patch carried a central symbol for the department (command, science, operations); a nurse's patch had a red cross over the science symbol. During the series the delta appeared only on uniforms, not on hulls or flags. Read: https://www.ex-astris-scientia.org/inconsistencies/delta-symbol.htm
- No freely licensed SVG of the delta turned up; Commons search hits were unrelated deltas. Search summary.

Used for: the division colours and the redrawn role insignia.

## Alerts

- Red alert is the highest alert status; yellow alert is a standby status; "double red alert" appears once, in "The Conscience of the King". Kirk orders yellow alert in "A Taste of Armageddon"; "Errand of Mercy" opens on red alert. Search summary (Trekipedia, The Logbook); pages not read.
- The flashing red bridge lights and the klaxon are general knowledge. The TrekCore archive has several red alert recordings (below).

## The ship

- Crew: Kirk commanded the ship and its "430-person crew" from 2264 to 2269. Read: Wikipedia, USS Enterprise (NCC-1701), above.
- Warp speed: Franz Joseph's first warp scale, in the 1975 Star Fleet Technical Manual, was "simply a cubic progression with no limit". The series itself showed warp 14.1 in "That Which Survives". Warp drive energy "passes through a matrix" of dilithium. Read: https://en.wikipedia.org/wiki/Warp_drive. DOMAIN uses speed = warp factor³ × c.
- Sister ships: the Constellation's hull number 1017 comes from production notes. Read: the Doomsday Machine article below. Exeter NCC-1672 and Intrepid NCC-1631 come from fan wikis; the Exeter has an alternate number, NCC-1706, in another fan source. Search summary.
- Stardates in the original series run from about 1300 to 5900 with no calendar rule. General knowledge.
- Ship system numbers (reaction rates, temperatures, shield percentages, deck count) do not exist in the show. Every limit in DOMAIN is marked as our choice.

## The six episodes

All read on Wikipedia. Only the beats used in the scenarios are listed.

| Episode | Beats used | Source |
|---|---|---|
| Balance of Terror (season 1, 1966) | Outpost 4 on the Romulan Neutral Zone attacked and destroyed; the attacker invisible, with a cloaking device; plasma torpedoes of limited range that need it to decloak; a nuclear weapon hidden in debris, set off by a point-blank phaser shot that shakes the ship; Kirk lowers power to look crippled; a coolant leak in phaser control; Spock fires the phasers; the Romulan commander self-destructs | https://en.wikipedia.org/wiki/Balance_of_Terror |
| The Naked Time (season 1, 1966) | Psi 2000 breaking up; the research station's life support off; an infection that spreads by touch and acts like alcohol; Riley locks himself in engineering and shuts down the engines; the orbit decays and the hull heats in the upper atmosphere; normal restart too slow; an untested cold mix of matter and antimatter; the ship thrown back "71 hours" | https://en.wikipedia.org/wiki/The_Naked_Time |
| The Doomsday Machine (season 2, 1967) | The Constellation's distress beacon; only Commodore Decker aboard; a machine "miles long" with antiproton beams and a hull of solid neutronium; phasers ineffective; transporter damaged, communications disrupted; a tractor beam pulls the Enterprise in; the Constellation's impulse engines rigged to explode after a 30 s delay that cannot be aborted; the transporter fails while beaming Kirk out | https://en.wikipedia.org/wiki/The_Doomsday_Machine_(Star_Trek:_The_Original_Series) |
| Mirror, Mirror (season 2, 1967) | The Halkan Council refuses dilithium mining; an ion storm during beam-up swaps the landing party with mirror-universe counterparts; Scott connects warp power to the transporter for the return | https://en.wikipedia.org/wiki/Mirror,_Mirror_(Star_Trek:_The_Original_Series) |
| The Trouble with Tribbles (season 2, 1967) | Deep Space Station K7 and the quadrotriticale grain; tribbles multiply on ship and station; the grain hold full of dead tribbles because the grain was poisoned; Scotty beams the tribbles into the Klingon ship's engine room | https://en.wikipedia.org/wiki/The_Trouble_with_Tribbles |
| Space Seed (season 1, 1967) | The Botany Bay adrift with sleepers kept for nearly 200 years; taken in tow; Khan takes over the ship; Kirk in a decompression chamber; anaesthetic gas vented through the ship; Khan goes to engineering to destroy it; exile to Ceti Alpha V | https://en.wikipedia.org/wiki/Space_Seed |

Not in the Wikipedia plot summaries, so not used as fact: the tribbles' breeding rate and McCoy's population figure, life support being cut deck by deck in Space Seed, and the Enterprise's shields being drained by the planet killer. The scenarios add these as dramatisation; the brief asked for them.

Air order and years are general knowledge.

## Fonts

| Family | Licence | Designer | Checked in |
|---|---|---|---|
| Michroma | OFL | Vernon Adams | https://raw.githubusercontent.com/google/fonts/main/ofl/michroma/METADATA.pb |
| Space Grotesk | OFL, weight axis 300-700 | Florian Karsten | https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/METADATA.pb |
| Space Mono | OFL, 400 and 700 with italics | Colophon Foundry | https://raw.githubusercontent.com/google/fonts/main/ofl/spacemono/METADATA.pb |

`npm view` on 14 Nov 2026: `@fontsource/michroma`, `@fontsource-variable/space-grotesk` and `@fontsource/space-mono` are all version 5.3.0 with licence `OFL-1.1`.

TOS-style fan fonts, search summary only: Final Frontier Old Style by Allen R. Walden, based on the show's title logo, listed as free; Final Frontier Shipside, freeware for non-commercial use; Airborne by Charles Casimiro Design, made for TOS-era hull lettering, listed as free for personal and commercial use if the licence notice travels with it; Dilithium Pixels NBP, freeware for non-commercial use. None of their licence pages could be opened.

## 3D

- Library versions from `npm view` on 14 Nov 2026: `three` 0.187.0 (MIT); `@react-three/fiber` 9.8.2 (MIT), peer `react >=19 <19.4`; `@react-three/drei` 10.7.9 (MIT), peer `react ^19` and fiber `^9.0.0`. The previous client used `react ^19.0.0`.
- Models, from the Sketchfab public API (`https://api.sketchfab.com/v3/search?type=models&downloadable=true` and `/v3/models/<uid>`), all marked downloadable:

| Model | Author | Licence | Triangles | GLB size |
|---|---|---|---|---|
| USS Enterprise (TOS 1966) | AleixoAlonso | CC Attribution | 21,126 | 1.16 MB |
| Classic U.S.S. Enterprise from Star Trek TOS | Major Stress | CC Attribution | 13,899 | 8.9 MB |
| USS Enterprise NCC-1701 | Terranimperial | CC Attribution | 46,253 | 3.3 MB |
| Constitution Class Mk-I: U.S.S. Enterprise | Flowrellik | CC Attribution | 39,021 | 5.6 MB |
| Classic Romulan Bird of Prey from ST:TOS | Major Stress | CC Attribution | 4,389 | 4.5 MB |

Rejected: ZEOCMF's models (CC Attribution-NonCommercial-NoDerivs, and 46-310 MB), and models of the 2009 film ship or later Enterprises.

## Sound

- The TrekCore audio page lists original-series clips by category: red alert, bridge background, communicator, computer, weapons, transporter, turbolift and doors, medical devices, warp. It states no copyright or licence; its only usage text is "Right click on a link to save it to your computer." Read: https://www.trekcore.com/audio/
- Every clip in DESIGN's sound table answered `HTTP 200` to a HEAD request on 14 Nov 2026, with the sizes given there.
- Browsers start audio only after a user gesture, so the app is muted until the speaker button is pressed. General knowledge.

## Credits and disclaimer

- The franchise's fan-production guidelines require this disclaimer: "Star Trek and all related marks, logos and characters are solely owned by CBS Studios Inc. This fan production is not endorsed by, sponsored by, nor affiliated with CBS, Paramount Pictures, or any other Star Trek franchise, and is a non-commercial fan-made film intended for recreational use. No commercial exhibition or distribution is permitted. No alleged independent rights will be asserted against CBS or Paramount Pictures." They also say the content must be original, "not reproductions, recreations or clips from any Star Trek production". Read: https://www.startrek.com/fan-films
- Those guidelines are written for fan films. The team lead's policy for this internal college hackathon allows existing Star Trek assets with credits, which goes further than they do. The problem statement asks that "Proper credit must be given when using external code or design resources."

## Accessibility

- WCAG 2.3.1: nothing may flash "more than three times in any one second period", unless below the general and red flash thresholds; saturated red flashes count separately. Read: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html. The red alert pulse is 1 Hz.
- Contrast ratios in DESIGN were computed with the WCAG 2 relative-luminance formula for every text token on every surface, including the red alert surfaces.

## Carried over from PitWall

From the team's previous telemetry project (`mernify/repo/docs/DESIGN.md`, `mernify/design/RESEARCH.md`): one shared animation-frame loop, React state at most four times a second, only `transform` and `opacity` animated in CSS, one attention animation at a time, reduced motion keeping colour changes, every status colour paired with a word, numbers that tick to new values, history and live merged by sequence number, self-hosted fonts. The race-car domain and its look are not reused.
