import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { buildApp } from './app.js';
import { httpCloudOps } from './cloudOps.js';
import { ConfigError, loadConfig } from './config.js';
import { FailoverService } from './failover.js';
import { prometheusMetrics } from './metrics.js';
import { temporalTransfers } from './transfers.js';

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, '../.env'), quiet: true });

let config;
try {
  config = loadConfig(process.env);
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`Configuration error: ${e.message}\nSee dashboard/.env.example, or run scripts/write-dashboard-env.sh.`);
    process.exit(2);
  }
  throw e;
}

const staticDir = resolve(here, '../dist');
const app = buildApp({
  failover: new FailoverService(
    httpCloudOps({
      baseUrl: config.cloudOpsUrl,
      apiKey: config.failoverApiKey,
      namespace: config.namespace,
      apiVersion: config.cloudOpsApiVersion,
    }),
  ),
  metrics: prometheusMetrics({
    baseUrl: config.metricsQueryUrl,
    useGoogleAuth: config.metricsQueryUrl.startsWith('https://monitoring.googleapis.com'),
  }),
  transfers: await temporalTransfers({
    address: config.address,
    namespace: config.namespace,
    apiKey: config.loadApiKey,
    insecure: config.insecure,
    taskQueue: config.taskQueue,
    pauseSeconds: config.pauseSeconds,
  }),
  info: { namespace: config.namespace, taskQueue: config.taskQueue, pauseSeconds: config.pauseSeconds },
  staticDir: existsSync(staticDir) ? staticDir : undefined,
});

await app.listen({ host: '127.0.0.1', port: config.port });
console.log(`Dashboard: http://localhost:${config.port}`);
