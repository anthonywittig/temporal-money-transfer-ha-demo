import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { buildApp } from './app.js';
import { httpAuditLog, httpCloudOps } from './cloudOps.js';
import { ConfigError, loadConfig } from './config.js';
import { FailoverService } from './failover.js';
import { FailoverHistory, namespaceName } from './failoverHistory.js';
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
const cloudOps = httpCloudOps({
  baseUrl: config.cloudOpsUrl,
  apiKey: config.failoverApiKey,
  namespace: config.namespace,
  apiVersion: config.cloudOpsApiVersion,
});
const app = buildApp({
  failover: new FailoverService(cloudOps),
  // Only with TEMPORAL_AUDIT_API_KEY: that key is used for nothing but listing audit logs.
  failoverHistory: config.auditApiKey
    ? new FailoverHistory(
        httpAuditLog({ baseUrl: config.cloudOpsUrl, apiKey: config.auditApiKey, apiVersion: config.cloudOpsApiVersion }),
        cloudOps,
        namespaceName(config.namespace),
      )
    : undefined,
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
  }),
  info: { namespace: config.namespace, taskQueue: config.taskQueue },
  staticDir: existsSync(staticDir) ? staticDir : undefined,
});

await app.listen({ host: '127.0.0.1', port: config.port });
console.log(`Dashboard: http://localhost:${config.port}`);
