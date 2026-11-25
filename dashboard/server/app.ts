import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { FailoverRejected, type FailoverService } from './failover.js';
import type { FailoverHistory } from './failoverHistory.js';
import type { MetricsSource } from './metrics.js';
import type { TransferStarter } from './transfers.js';

export interface Deps {
  failover: FailoverService;
  failoverHistory?: FailoverHistory;
  metrics: MetricsSource;
  transfers: TransferStarter;
  info: { namespace: string; taskQueue: string };
  staticDir?: string;
  logger?: boolean;
}

const MAX_BATCH = 500;

/** Every API error is returned as { error } with a non-2xx status so the UI can show it. */
export function buildApp(deps: Deps): FastifyInstance {
  const app = Fastify({ logger: deps.logger === false ? false : { level: 'info' } });

  app.setErrorHandler((err: unknown, _req, reply) => {
    const e = err instanceof Error ? err : new Error(String(err));
    const status = e instanceof FailoverRejected ? 409 : (e as { statusCode?: number }).statusCode ?? 502;
    reply.status(status).send({ error: e.message });
  });

  app.get('/api/info', async () => deps.info);

  app.get('/api/state', async () => deps.failover.state());

  app.post('/api/failover', async () => deps.failover.failover());

  // Failovers from any source (via the audit log); enabled only when an audit key is configured.
  app.get<{ Querystring: { window?: string } }>('/api/failovers', async (req) => {
    if (!deps.failoverHistory) return { enabled: false, failovers: [] };
    const window = Math.min(Math.max(Number(req.query.window) || 600, 60), 3600);
    return { enabled: true, failovers: await deps.failoverHistory.recent(window) };
  });

  app.get<{ Querystring: { window?: string } }>('/api/metrics', async (req) => {
    const window = Math.min(Math.max(Number(req.query.window ?? 600) || 600, 60), 3600);
    return deps.metrics.snapshot(window);
  });

  app.get('/api/inflight', async () => ({ inFlight: await deps.transfers.inFlight() }));
  app.get<{ Querystring: { window?: string } }>('/api/crossed', async (req) => {
    const window = Math.min(Math.max(Number(req.query.window) || 600, 60), 86_400);
    return { crossed: await deps.transfers.crossedRegions(window), windowSeconds: window };
  });

  app.post<{ Body: { count?: number } }>('/api/transfers', async (req, reply) => {
    const count = Number(req.body?.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) {
      return reply.status(400).send({ error: `count must be an integer from 1 to ${MAX_BATCH}` });
    }
    return deps.transfers.start(count);
  });

  if (deps.staticDir) {
    app.register(fastifyStatic, { root: deps.staticDir });
  }
  return app;
}
