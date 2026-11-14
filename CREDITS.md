# Credits

Third-party assets used in Subspace. Star Trek and related marks belong to their owners; this is a non-commercial fan project made for a college hackathon.

- **3D model**: "Classic U.S.S. Enterprise from Star Trek TOS" by Major Stress, [Sketchfab](https://sketchfab.com/3d-models/classic-uss-enterprise-from-star-trek-tos-acfe41446dc149848559e5542f59cef9), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). We converted its materials to metal-roughness, compressed the geometry (meshopt) and re-encoded the 2k textures as WebP: `client/public/models/enterprise.glb`.
- **Opening narration and theme**: from Star Trek: The Original Series (CBS/Paramount), taken from the YouTube upload "Star Trek Original Series Intro (HQ)" by dinadangdong, used non-commercially in a college hackathon. We re-encoded it to 96 kbps: `client/public/audio/intro.mp3`.
- **Background music**: the Star Trek: The Original Series end-credits theme by Alexander Courage (CBS/Paramount), taken from the YouTube upload "Star Trek Original Series Ending Credits" by Paul Hill (https://www.youtube.com/watch?v=XXPW5QV4Ymw), used non-commercially in a college hackathon. We cut it to its first 29.9 s and re-encoded it to mono 64 kbps: `client/public/audio/theme.mp3`.
- **Fonts**: Michroma (Vernon Adams), Space Grotesk (Florian Karsten) and Space Mono (Colophon Foundry), SIL Open Font License 1.1, self-hosted from the `@fontsource` packages.
- **Sound effects**: original-series sound effects via [TrekCore](https://www.trekcore.com/audio/) (audio © CBS Studios), trimmed to mono 80 kbps for non-commercial fan use: `client/public/sfx/`. Sources: `press` toscomputer/tos_com_beep_1, `ack` toscomputer/tos_com_beep_3, `hail` toscomputer/tos_hailing, `intercom` toscomputer/tos_intercom_whistle, `yellow` redalertandklaxons/tos_klaxon, `red` redalertandklaxons/tos_red_alert, `phaser` weapons/tos_ship_phaser_1, `torpedo` weapons/tos_photon_torpedo, `station` doors/tos_swoosh_2, `lift` turbolift/tos_turbolift, `warp` warp/tos_flyby_1, `chirp` communicator/tos_chirp_1, `boom` explosions/tos_hullhit_1, `transport` transporters/tos_transporter1_top, `reactor` other/tos_reactor_up_down, `heartbeat` medicaldevices/tos_heartbeats_1.

## Open-source libraries

Every npm package the workspaces depend on directly, with the version installed by `npm install` and its licence (read from each package's own `package.json`). Their own dependencies come with them under their licences; `npm ls --all` lists them.

| Package | Version | Licence | Used in | What for |
|---|---|---|---|---|
| [react](https://react.dev/), [react-dom](https://react.dev/) | 19.3.1 | MIT | client | the UI |
| [react-router-dom](https://github.com/remix-run/react-router) | 7.18.5 | MIT | client | routes for the bridge and stations |
| [three](https://threejs.org/) | 0.187.0 | MIT | client | 3D ship and viewscreen |
| [@react-three/fiber](https://github.com/pmndrs/react-three-fiber) | 9.8.2 | MIT | client | three.js in React |
| [@react-three/drei](https://github.com/pmndrs/drei) | 10.7.9 | MIT | client | model loading, camera and scene helpers |
| [@react-three/postprocessing](https://github.com/pmndrs/react-postprocessing) | 3.2.2 | MIT | client | bloom and vignette on the 3D scenes |
| [postprocessing](https://github.com/pmndrs/postprocessing) | 6.39.6 | Zlib | client | the effects under @react-three/postprocessing |
| [uplot](https://github.com/leeoniya/uPlot) | 1.6.32 | MIT | client | live and history charts |
| [@fontsource/michroma](https://fontsource.org/fonts/michroma), [@fontsource/space-mono](https://fontsource.org/fonts/space-mono), [@fontsource-variable/space-grotesk](https://fontsource.org/fonts/space-grotesk) | 5.3.0 | OFL-1.1 | client | self-hosted fonts |
| [express](https://expressjs.com/) | 5.3.0 | MIT | server | REST API |
| [socket.io](https://github.com/socketio/socket.io) | 4.8.4 | MIT | server | `/ingest` and `/live` namespaces |
| [socket.io-client](https://github.com/socketio/socket.io) | 4.8.4 | MIT | client, simulator, loadtest (server tests) | the other end of those sockets |
| [socket.io-msgpack-parser](https://github.com/socketio/socket.io-msgpack-parser) | 3.0.2 | MIT | server, client, simulator, loadtest | MessagePack on every socket |
| [mongoose](https://mongoosejs.com) | 8.24.9 | MIT | server | MongoDB models, time-series collection |
| [zod](https://zod.dev) | 3.25.76 | MIT | server | request and command validation |
| [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) | 9.0.3 | MIT | server | sign-in tokens |
| [bcryptjs](https://github.com/dcodeIO/bcrypt.js) | 2.4.3 | MIT | server | password hashes |
| [helmet](https://helmet.js.org/) | 8.3.0 | MIT | server | security headers |
| [cors](https://github.com/expressjs/cors) | 2.8.6 | MIT | server | allowed client origins |
| [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) | 7.5.1 | MIT | server | rate limits on the API and sign-in |
| [pino](https://getpino.io) | 9.14.0 | MIT | server | logging |
| [dotenv](https://github.com/motdotla/dotenv) | 16.6.1 | BSD-2-Clause | server | `.env` configuration |
| [vite](https://vite.dev), [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 6.4.6, 5.2.0 | MIT | client (dev) | dev server and production build |

The platforms under them: [Node.js](https://nodejs.org/) (MIT) and [MongoDB](https://www.mongodb.com/) 8 (Server Side Public License; the `mongo:8` Docker image locally, MongoDB Atlas when hosted).
