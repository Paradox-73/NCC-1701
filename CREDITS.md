# Credits

Third-party assets used in Subspace. Star Trek and related marks belong to their owners; this is a non-commercial fan project made for a college hackathon.

- **3D model**: "Classic U.S.S. Enterprise from Star Trek TOS" by Major Stress, [Sketchfab](https://sketchfab.com/3d-models/classic-uss-enterprise-from-star-trek-tos-acfe41446dc149848559e5542f59cef9), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). We converted its materials to metal-roughness, compressed the geometry (meshopt) and re-encoded the 2k textures as WebP: `client/public/models/enterprise.glb`.
- **Opening narration and theme**: from Star Trek: The Original Series (CBS/Paramount), taken from the YouTube upload "Star Trek Original Series Intro (HQ)" by dinadangdong, used non-commercially in a college hackathon. We re-encoded it to 96 kbps: `client/public/audio/intro.mp3`.
- **Background music**: the Star Trek: The Original Series end-credits theme by Alexander Courage (CBS/Paramount), taken from the YouTube upload "Star Trek Original Series Ending Credits" by Paul Hill (https://www.youtube.com/watch?v=XXPW5QV4Ymw), used non-commercially in a college hackathon. We cut it to its first 29.9 s and re-encoded it to mono 64 kbps: `client/public/audio/theme.mp3`.
- **Fonts**: Michroma (Vernon Adams), Space Grotesk (Florian Karsten) and Space Mono (Colophon Foundry), SIL Open Font License 1.1, self-hosted from the `@fontsource` packages.
- **Sound effects**: original-series sound effects via [TrekCore](https://www.trekcore.com/audio/) (audio © CBS Studios), trimmed to mono 80 kbps for non-commercial fan use: `client/public/sfx/`. Sources: `press` toscomputer/tos_com_beep_1, `ack` toscomputer/tos_com_beep_3, `hail` toscomputer/tos_hailing, `intercom` toscomputer/tos_intercom_whistle, `yellow` redalertandklaxons/tos_klaxon, `red` redalertandklaxons/tos_red_alert, `phaser` weapons/tos_ship_phaser_1, `torpedo` weapons/tos_photon_torpedo, `station` doors/tos_swoosh_2, `lift` turbolift/tos_turbolift, `warp` warp/tos_flyby_1, `chirp` communicator/tos_chirp_1, `boom` explosions/tos_hullhit_1, `transport` transporters/tos_transporter1_top, `reactor` other/tos_reactor_up_down, `heartbeat` medicaldevices/tos_heartbeats_1.

## Open-source libraries

Runtime dependencies, with the version installed and the licence from each package.

| Library | Version | Licence | Used in |
|---|---|---|---|
| [@fontsource-variable/space-grotesk](https://www.npmjs.com/package/@fontsource-variable/space-grotesk) | 5.3.0 | OFL-1.1 | client |
| [@fontsource/michroma](https://www.npmjs.com/package/@fontsource/michroma) | 5.3.0 | OFL-1.1 | client |
| [@fontsource/space-mono](https://www.npmjs.com/package/@fontsource/space-mono) | 5.3.0 | OFL-1.1 | client |
| [@react-three/drei](https://www.npmjs.com/package/@react-three/drei) | 10.7.9 | MIT | client |
| [@react-three/fiber](https://www.npmjs.com/package/@react-three/fiber) | 9.8.2 | MIT | client |
| [@react-three/postprocessing](https://www.npmjs.com/package/@react-three/postprocessing) | 3.2.2 | MIT | client |
| [postprocessing](https://www.npmjs.com/package/postprocessing) | 6.39.6 | Zlib | client |
| [react](https://www.npmjs.com/package/react) | 19.3.1 | MIT | client |
| [react-dom](https://www.npmjs.com/package/react-dom) | 19.3.1 | MIT | client |
| [react-router-dom](https://www.npmjs.com/package/react-router-dom) | 7.18.5 | MIT | client |
| [socket.io-client](https://www.npmjs.com/package/socket.io-client) | 4.8.4 | MIT | client, simulator, loadtest |
| [socket.io-msgpack-parser](https://www.npmjs.com/package/socket.io-msgpack-parser) | 3.0.2 | MIT | client, server, simulator, loadtest |
| [three](https://www.npmjs.com/package/three) | 0.187.0 | MIT | client |
| [uplot](https://www.npmjs.com/package/uplot) | 1.6.32 | MIT | client |
| [bcryptjs](https://www.npmjs.com/package/bcryptjs) | 2.4.3 | MIT | server |
| [cors](https://www.npmjs.com/package/cors) | 2.8.6 | MIT | server |
| [dotenv](https://www.npmjs.com/package/dotenv) | 16.6.1 | BSD-2-Clause | server |
| [express](https://www.npmjs.com/package/express) | 5.3.0 | MIT | server |
| [express-rate-limit](https://www.npmjs.com/package/express-rate-limit) | 7.5.1 | MIT | server |
| [helmet](https://www.npmjs.com/package/helmet) | 8.3.0 | MIT | server |
| [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken) | 9.0.3 | MIT | server |
| [mongoose](https://www.npmjs.com/package/mongoose) | 8.24.9 | MIT | server |
| [pino](https://www.npmjs.com/package/pino) | 9.14.0 | MIT | server |
| [socket.io](https://www.npmjs.com/package/socket.io) | 4.8.4 | MIT | server |
| [zod](https://www.npmjs.com/package/zod) | 3.25.76 | MIT | server |
