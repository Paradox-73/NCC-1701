import http from 'node:http';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { Server } from 'socket.io';
import parser from 'socket.io-msgpack-parser';
import { Detector } from './anomaly/detector.js';
import { makeAlerts } from './alerts.js';
import { checkSecrets, loadConfig } from './config.js';
import { connectDb, disconnectDb, ensureAlertsTtl, ensureTelemetry } from './db.js';
import { setupIngest } from './ingest/namespace.js';
import { IngestWatch } from './ingest/watch.js';
import { SCENARIOS } from '@ncc/shared/scenarios/index.js';
import { Writer } from './ingest/writer.js';
import { Broadcaster } from './live/broadcaster.js';
import { setupLive } from './live/namespace.js';
import { makeLogger } from './logger.js';
import { Metrics } from './metrics.js';
import { adminRoutes } from './routes/admin.js';
import { alertRoutes } from './routes/alerts.js';
import { authRoutes } from './routes/auth.js';
import { shipRoutes } from './routes/ships.js';
import { sourceRoutes } from './routes/sources.js';
import { World } from './ships/world.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { errorHandler, limiter, requireAuth } from './middleware/index.js';
import { seed } from './seed.js';
import { SourceStates } from './state/sourceState.js';

/** Builds the whole server; nothing listens or connects until start(). */
export function createServer(overrides = {}) {
  const config = loadConfig(overrides);
  const log = makeLogger(config.logLevel);
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    parser, // MessagePack on every namespace
    cors: { origin: config.corsOrigin },
    maxHttpBufferSize: 256 * 1024, // oversized payloads are refused before parsing
    pingInterval: 10000,
    pingTimeout: 10000,
  });
  io.use((_socket, next) => next(new Error('unauthorized'))); // the default namespace serves nothing: clients use /ingest or /live

  let telemetry = null;
  const getTelemetry = () => telemetry;
  const metrics = new Metrics();
  const alerts = makeAlerts({ io, log, metrics });
  const detector = new Detector({ onAlert: (a) => { alerts.raise(a); world.onAlert(a); }, debounceMs: config.debounceMs, linkLossMs: config.linkLossMs });
  const watch = new IngestWatch({ detector });
  const states = new SourceStates();
  const world = new World({
    sendSim: (id, cmd) => ingest.sendCommand(id, cmd),
    emit: (shipId, event, payload) => io.of('/live').to(`ship:${shipId}`).emit(event, payload),
    online: (id) => ingest.sockets.has(id),
    latest: (id) => states.sources.get(id)?.v ?? null,
    detector,
    scenarios: SCENARIOS,
    log,
    resolveAlerts: (ids, reason) => alerts.resolveForShips(ids, reason),
  });
  const writer = new Writer({
    getCollection: getTelemetry,
    flushMs: config.flushMs,
    flushSamples: config.flushSamples,
    highWater: config.highWater,
    log,
  });
  const broadcaster = new Broadcaster({ io, config, metrics, states, detector, world });
  const ingest = setupIngest({ io, config, metrics, writer, states, detector, broadcaster, watch, onConnect: (id) => world.onSimConnect(id), log });
  setupLive({ io, config, metrics, alerts, log });
  const nsp = io.of('/live');
  metrics.gauges = () => ({
    sourcesConnected: ingest.sockets.size,
    dashboards: nsp.sockets.size,
    writerQueue: writer.depth,
    lastFlushSize: writer.lastFlush.size,
    lastFlushMs: Math.round(writer.lastFlush.ms * 10) / 10,
    written: writer.written,
    writeFailures: writer.failed,
    backpressured: writer.backpressured,
    backpressureMs: writer.backpressureTotalMs,
  });

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', limiter(config.apiRateLimit));
  app.use('/api', authRoutes({ config })); // login, me and health
  app.use('/api', requireAuth(config.jwtSecret));
  const deps = { config, states, detector, alerts, metrics, ingest, getTelemetry, writer, world };
  app.use('/api', sourceRoutes(deps), telemetryRoutes(deps), alertRoutes(deps), adminRoutes(deps), shipRoutes(deps));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
  app.use(errorHandler(log));

  const timers = [];
  let stopped = false;

  return {
    config, app, io, httpServer, metrics, writer, states, detector, ingest, alerts, world, watch, log, getTelemetry,
    async start() {
      checkSecrets(config);
      await connectDb(config.mongoUri);
      telemetry = await ensureTelemetry(config.telemetryTtlSec, { timeseries: config.telemetryTimeseries, log });
      await ensureAlertsTtl(config.alertsTtlSec);
      await seed(log);
      await alerts.closeStale();
      await ingest.load();
      await new Promise((resolve) => httpServer.listen(config.port, resolve));
      broadcaster.start();
      timers.push(setInterval(() => { detector.tick(); watch.tick(); }, 250).unref(), setInterval(() => world.tick(), 100).unref(), setInterval(() => ingest.save(), 5000).unref());
      const port = httpServer.address().port;
      log.info({ port }, 'NCC-1701 server listening');
      return port;
    },
    /** Stops timers and connections, writes everything still queued, then disconnects. */
    async stop() {
      if (stopped) return;
      stopped = true;
      timers.forEach(clearInterval);
      broadcaster.stop();
      await new Promise((resolve) => io.close(resolve));
      await alerts.flush();
      await writer.stop();
      await ingest.save();
      metrics.stop();
      await disconnectDb();
    },
  };
}
