export interface Config {
  namespace: string;
  address: string;
  loadApiKey?: string;
  failoverApiKey: string;
  insecure: boolean;
  gcpProjectId: string;
  taskQueue: string;
  pauseSeconds: number;
  port: number;
  cloudOpsUrl: string;
  cloudOpsApiVersion?: string;
  metricsQueryUrl: string;
}

export class ConfigError extends Error {}

/** Reads config from the environment and throws a ConfigError naming every missing variable. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const missing: string[] = [];
  const required = (name: string): string => {
    const v = env[name]?.trim();
    if (!v) missing.push(name);
    return v ?? '';
  };
  const insecure = env.TEMPORAL_INSECURE?.toLowerCase() === 'true';

  const namespace = required('TEMPORAL_NAMESPACE');
  const address = required('TEMPORAL_ADDRESS');
  const loadApiKey = insecure ? env.TEMPORAL_LOAD_API_KEY?.trim() || undefined : required('TEMPORAL_LOAD_API_KEY');
  const failoverApiKey = required('TEMPORAL_FAILOVER_API_KEY');
  const gcpProjectId = required('GCP_PROJECT_ID');

  if (missing.length > 0) {
    throw new ConfigError(`missing required environment variable(s): ${missing.join(', ')}`);
  }

  return {
    namespace,
    address,
    loadApiKey,
    failoverApiKey,
    insecure,
    gcpProjectId,
    taskQueue: env.TASK_QUEUE?.trim() || 'money-transfer',
    pauseSeconds: intOr(env, 'TRANSFER_PAUSE_SECONDS', 60),
    port: intOr(env, 'PORT', 3000),
    cloudOpsUrl: (env.CLOUD_OPS_URL?.trim() || 'https://saas-api.tmprl.cloud').replace(/\/$/, ''),
    cloudOpsApiVersion: env.CLOUD_OPS_API_VERSION?.trim() || undefined,
    metricsQueryUrl: (
      env.METRICS_QUERY_URL?.trim() ||
      `https://monitoring.googleapis.com/v1/projects/${gcpProjectId}/location/global/prometheus`
    ).replace(/\/$/, ''),
  };
}

function intOr(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new ConfigError(`${name} must be a non-negative integer, got '${raw}'`);
  return n;
}
