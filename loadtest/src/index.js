// Load test: N sources at H Hz plus K dashboard clients. See loadtest/README.md.
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Hist } from './hist.js';
import { GROUPS, LIMITS, SOURCES } from '@ncc/shared/schema.js';

const PRESETS = {
  smoke: { sources: 5, clients: 5, seconds: 15 },
  small: { sources: 10, clients: 10, seconds: 30 },
  medium: { sources: 40, clients: 100, seconds: 60 },
  large: { sources: 99, clients: 250, seconds: 90 },
};

const raw = Object.fromEntries(process.argv.slice(2).flatMap((x, i, all) => (x.startsWith('--') ? [[x.slice(2), all[i + 1] === undefined || all[i + 1].startsWith('--') ? 'true' : all[i + 1]]] : [])));
const preset = raw.preset ? PRESETS[raw.preset] : null;
if (raw.preset && !preset) throw new Error(`unknown preset ${raw.preset}, use ${Object.keys(PRESETS).join('|')}`);
const num = (k, d) => Number(raw[k] ?? preset?.[k] ?? d);
const cfg = {
  preset: raw.preset ?? 'custom',
  url: (raw.url ?? process.env.LOADTEST_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  sources: num('sources', 40),
  // first source id; start above a running simulator's sources (it uses the registry ids) so the two never replace each other's connection
  firstSource: num('first-source', SOURCES.length + 1),
  // sources the dashboard clients subscribe to, e.g. --watch 1-3 for a running simulator; default: the load test's own sources
  watch: raw.watch ? raw.watch.split(',').flatMap((p) => { const [a, b] = p.split('-').map(Number); return Array.from({ length: (b || a) - a + 1 }, (_, i) => a + i); }) : null,
  hz: num('hz', 10),
  clients: num('clients', 50),
  seconds: num('seconds', 60),
  groups: (raw.groups ?? GROUPS.slice(0, 2).join(',')).split(',').filter((g) => GROUPS.includes(g)),
  key: raw.key ?? process.env.DEVICE_KEY ?? 'dev-device-key',
  user: raw.user ?? 'command',
  password: raw.password ?? process.env.LOADTEST_PASSWORD ?? 'ncc-command',
  inject: { dup: Number(raw.dup ?? 0), reorder: Number(raw.reorder ?? 0), invalid: Number(raw.invalid ?? 0) },
};
if (!cfg.groups.length) throw new Error('--groups needs at least one of ' + GROUPS.join(','));

const here = dirname(fileURLToPath(import.meta.url));
const workerFile = join(here, 'worker.js');
const cores = Math.max(1, cpus().length - 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const split = (arr, n) => Array.from({ length: n }, (_, i) => arr.filter((_, j) => j % n === i)).filter((a) => a.length);

function spawn(role, wcfg) {
  const w = new Worker(workerFile, { workerData: { role, cfg: wcfg } });
  const p = { w, ready: new Promise((r) => w.once('message', (m) => (m.ready ? r() : null))), result: new Promise((res, rej) => { w.on('message', (m) => !m.ready && res(m)); w.on('error', rej); }) };
  return p;
}

async function login() {
  const res = await fetch(`${cfg.url}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: cfg.user, password: cfg.password }) });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
  return (await res.json()).token;
}

async function metrics(token) {
  try {
    const res = await fetch(`${cfg.url}/api/metrics`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    return res.ok ? await res.json() : { error: `HTTP ${res.status}` };
  } catch (e) {
    return { error: e.message };
  }
}

async function main() {
  console.log(`load test ${cfg.preset}: ${cfg.sources} sources x ${cfg.hz} Hz, ${cfg.clients} dashboard clients, ${cfg.seconds} s, groups ${cfg.groups.join(',')} -> ${cfg.url}`);
  // One login for all clients: the server limits login attempts, and the token is what a /live connection needs.
  const token = cfg.clients > 0 ? await login() : null;
  const sourceIds = Array.from({ length: cfg.sources }, (_, i) => i + cfg.firstSource);
  if (sourceIds.length && sourceIds.at(-1) > LIMITS.maxSourceId) throw new Error(`sources ${cfg.firstSource}..${sourceIds.at(-1)} exceed the server limit of ${LIMITS.maxSourceId}`);

  const before = await metrics(token);
  const cpu0 = process.cpuUsage();
  const t0 = Date.now();
  const clientWorkers = cfg.clients > 0 ? split(Array.from({ length: cfg.clients }), Math.min(Math.ceil(cfg.clients / 60), cores)).map((a) => spawn('clients', { count: a.length, token, url: cfg.url, sourceIds: cfg.watch ?? sourceIds, groups: cfg.groups })) : [];
  await Promise.all(clientWorkers.map((c) => c.ready));
  const sourceWorkers = split(sourceIds, Math.min(Math.ceil(cfg.sources / 25), cores)).map((ids) => spawn('sources', { sourceIds: ids, key: cfg.key, url: cfg.url, hz: cfg.hz, inject: cfg.inject }));

  const startedAt = Date.now();
  const progress = setInterval(() => console.log(`  ${Math.round((Date.now() - startedAt) / 1000)} s / ${cfg.seconds} s, rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`), 5000);
  await sleep(cfg.seconds * 1000);
  clearInterval(progress);
  sourceWorkers.forEach((c) => c.w.postMessage('stop'));
  const sourceRes = await Promise.all(sourceWorkers.map((c) => c.result));
  await sleep(300); // frames still in flight to the dashboards
  clientWorkers.forEach((c) => c.w.postMessage('stop'));
  const cliRes = await Promise.all(clientWorkers.map((c) => c.result));
  const wall = (Date.now() - t0) / 1000;
  const cpu = process.cpuUsage(cpu0);

  const serverMetrics = await metrics(token);
  await Promise.all([...sourceWorkers, ...clientWorkers].map((c) => c.w.terminate()));

  const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
  const st = (k) => sum(sourceRes, (r) => r.stats[k] ?? 0);
  const ackH = Hist.merge(sourceRes.map((r) => r.ack));
  const e2eH = Hist.merge(cliRes.map((r) => r.e2e));
  const ct = (k) => sum(cliRes, (r) => r.tot[k]);
  const connectedClients = sum(cliRes, (r) => r.connectedAtEnd);
  const secs = cfg.seconds;
  const result = {
    config: cfg,
    when: new Date(t0).toISOString(),
    seconds: secs,
    sources: {
      offeredPerSec: +(st('sentSamples') / secs).toFixed(0),
      nominalPerSec: cfg.sources * cfg.hz,
      sent: st('sentSamples'),
      acked: st('ackedSamples'),
      accepted: st('accepted'),
      acceptedPerSec: +(st('accepted') / secs).toFixed(0),
      duplicates: st('duplicates'),
      stale: st('stale'),
      invalid: st('invalid'),
      throttled: st('throttled'),
      droppedLocally: st('dropped'),
      unackedAtEnd: st('unacked'),
      ackTimeouts: st('timeouts'),
      notOkAcks: st('notOk'),
      disconnects: st('reconnects'),
      ackRttMs: ackH.summary(),
    },
    injected: { dup: sum(sourceRes, (r) => r.inj.dup), reorder: sum(sourceRes, (r) => r.inj.reorder), invalid: sum(sourceRes, (r) => r.inj.invalid) },
    clients: {
      requested: cfg.clients,
      connectedAtEnd: connectedClients,
      frames: ct('frames'),
      samplesReceived: ct('samples'),
      overviewEvents: ct('overview'),
      connectErrors: ct('connectErrors'),
      unexpectedDisconnects: ct('disconnects'),
      subscribeFailures: ct('subscribeFailures'),
      framesPerClientPerSec: cfg.clients ? +(ct('frames') / cfg.clients / secs).toFixed(1) : 0,
      bytesPerClientPerSec: cfg.clients ? Math.round(ct('bytes') / cfg.clients / secs) : 0,
      endToEndMs: e2eH.summary(),
    },
    tool: { cpuCoresUsed: +((cpu.user + cpu.system) / 1e6 / wall).toFixed(2), rssMB: Math.round(process.memoryUsage().rss / 1e6), workers: sourceWorkers.length + clientWorkers.length },
    serverMetrics,
    // change of every counter in `totals` (received, accepted, duplicates, stale, invalid, throttled, framesOut, framesDelivered, bytesOut, alerts, batches) over the run, for comparing with the injected counts (server counters are cumulative)
    serverDelta: Object.fromEntries(Object.entries(serverMetrics.totals ?? {}).filter(([k, v]) => typeof v === "number" && typeof before.totals?.[k] === "number").map(([k, v]) => [k, v - before.totals[k]])),
  };
  // injected counts only line up with the server's counters when nothing was resent after a reconnect
  result.injectionCheck = {
    duplicatesExpected: result.injected.dup,
    duplicatesCounted: result.sources.duplicates,
    invalidExpected: result.injected.invalid,
    invalidCounted: result.sources.invalid,
    match: result.injected.dup === result.sources.duplicates && result.injected.invalid === result.sources.invalid,
    note: result.sources.disconnects ? 'reconnects happened, resent batches add duplicates' : undefined,
  };
  const errors = result.sources.ackTimeouts + result.sources.notOkAcks + result.sources.disconnects + result.clients.connectErrors + result.clients.unexpectedDisconnects + result.clients.subscribeFailures;

  const dir = join(here, '..', 'results');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date(t0).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = join(dir, `${cfg.preset}-${stamp}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  const summary = join(dir, 'SUMMARY.md');
  if (!existsSync(summary)) {
    writeFileSync(summary, '# Load test results\n\n| When (UTC) | Preset | Sources | Hz | Clients | Seconds | Offered ev/s | Accepted ev/s | End-to-end p50 / p95 / p99 ms | Ack RTT p50 / p99 ms | KB/s per client | Clients connected | Errors |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n');
  }
  const e = result.clients.endToEndMs;
  const a = result.sources.ackRttMs;
  appendFileSync(summary, `| ${result.when.slice(0, 19)} | ${cfg.preset} | ${cfg.sources} | ${cfg.hz} | ${cfg.clients} | ${secs} | ${result.sources.offeredPerSec} | ${result.sources.acceptedPerSec} | ${e.p50 ?? '-'} / ${e.p95 ?? '-'} / ${e.p99 ?? '-'} | ${a.p50 ?? '-'} / ${a.p99 ?? '-'} | ${(result.clients.bytesPerClientPerSec / 1024).toFixed(1)} | ${connectedClients}/${cfg.clients} | ${errors} |\n`);

  console.log(JSON.stringify({ ...result, serverMetrics: undefined, serverDelta: undefined }, null, 2));
  console.log('server /api/metrics delta over the run:', JSON.stringify(result.serverDelta));
  console.log(`written ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
