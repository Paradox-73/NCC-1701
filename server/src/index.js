import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from './app.js';

const server = createServer();

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  server.log.info({ signal }, 'shutting down, flushing writer');
  const force = setTimeout(() => process.exit(1), 10000).unref();
  await server.stop();
  clearTimeout(force);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// SIM_EMBED=1 runs the simulator as a child process that connects over 127.0.0.1. The hosted deploy uses it
// because Render has no free background worker (render.yaml). A crashed simulator restarts after 5 s.
let sim = null;
function startSimulator(port) {
  sim = fork(fileURLToPath(new URL('../../simulator/src/index.js', import.meta.url)), {
    env: { ...process.env, SIM_URL: `http://127.0.0.1:${port}`, DEVICE_KEY: server.config.deviceKey },
  });
  sim.on('exit', (code, signal) => {
    if (closing) return;
    server.log.warn({ code, signal }, 'simulator exited, restarting in 5 s');
    setTimeout(() => startSimulator(port), 5000).unref();
  });
}
process.on('exit', () => sim?.kill());

server
  .start()
  .then((port) => {
    if (server.config.simEmbed) startSimulator(port);
  })
  .catch((err) => {
    server.log.error({ err: err.message }, 'failed to start');
    process.exit(1);
  });
