import http from 'node:http';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { Server } from 'socket.io';
import parser from 'socket.io-msgpack-parser';
import { checkSecrets, loadConfig } from './config.js';
import { connectDb, disconnectDb, ensureAlertsTtl, ensureTelemetry } from './db.js';
import { makeLogger } from './logger.js';
import { Metrics } from './metrics.js';
import { authRoutes } from './routes/auth.js';
import { errorHandler, limiter, requireAuth } from './middleware/index.js';
import { seed } from './seed.js';

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

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', limiter(config.apiRateLimit));
  app.use('/api', authRoutes({ config })); // login, me and health
  app.use('/api', requireAuth(config.jwtSecret));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
  app.use(errorHandler(log));

  const timers = [];
  let stopped = false;

  return {
    config, app, io, httpServer, metrics, log, getTelemetry,
    async start() {
      checkSecrets(config);
      await connectDb(config.mongoUri);
      telemetry = await ensureTelemetry(config.telemetryTtlSec, { timeseries: config.telemetryTimeseries, log });
      await ensureAlertsTtl(config.alertsTtlSec);
      await seed(log);
      await new Promise((resolve) => httpServer.listen(config.port, resolve));
      const port = httpServer.address().port;
      log.info({ port }, 'NCC-1701 server listening');
      return port;
    },
    /** Stops timers and connections, then disconnects. */
    async stop() {
      if (stopped) return;
      stopped = true;
      timers.forEach(clearInterval);
      await new Promise((resolve) => io.close(resolve));
      metrics.stop();
      await disconnectDb();
    },
  };
}
