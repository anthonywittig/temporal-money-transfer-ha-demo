import { GoogleAuth } from 'google-auth-library';
import { describeFetchError } from './cloudOps.js';

export interface Series {
  region: string;
  points: [number, number][]; // [unix seconds, value]
}

export interface MetricsSnapshot {
  stepRate: Series[];
  completedRate: Series[];
}

export interface MetricsSource {
  snapshot(windowSeconds: number): Promise<MetricsSnapshot>;
}

export class MetricsError extends Error {}

export const QUERIES = {
  stepRate: 'sum by (region) (rate(transfer_steps_total[30s]))',
  completedRate: 'sum by (region) (rate(transfers_completed_total[30s]))',
};

/**
 * Queries a Prometheus-compatible API. By default this is Google Managed Prometheus, authenticated
 * with the presenter's Application Default Credentials (`gcloud auth application-default login`).
 */
export function prometheusMetrics(opts: { baseUrl: string; useGoogleAuth: boolean; fetchImpl?: typeof fetch }): MetricsSource {
  const doFetch = opts.fetchImpl ?? fetch;
  const auth = opts.useGoogleAuth
    ? new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/monitoring.read'] })
    : undefined;

  async function headers(): Promise<Record<string, string>> {
    if (!auth) return {};
    try {
      const token = await auth.getAccessToken();
      if (!token) throw new Error('no access token');
      return { Authorization: `Bearer ${token}` };
    } catch (e) {
      throw new MetricsError(
        `Google credentials unavailable (run 'gcloud auth application-default login'): ${(e as Error).message}`,
      );
    }
  }

  async function rangeQuery(query: string, windowSeconds: number): Promise<Series[]> {
    const end = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams({
      query,
      start: String(end - windowSeconds),
      end: String(end),
      step: '5',
    });
    const auth = await headers();
    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}/api/v1/query_range?${params}`, {
        headers: auth,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new MetricsError(`metrics API unreachable (${opts.baseUrl}): ${describeFetchError(e)}`);
    }
    const text = await res.text();
    if (!res.ok) throw new MetricsError(`metrics query failed: ${res.status} ${text.slice(0, 300)}`);
    const json = JSON.parse(text);
    if (json.status !== 'success') throw new MetricsError(`metrics query error: ${json.error ?? text.slice(0, 300)}`);
    return (json.data?.result ?? []).map((r: any) => ({
      region: r.metric?.region ?? 'unknown',
      points: (r.values ?? []).map(([t, v]: [number, string]) => [Number(t), Number(v)] as [number, number]),
    }));
  }

  return {
    async snapshot(windowSeconds) {
      const [stepRate, completedRate] = await Promise.all([
        rangeQuery(QUERIES.stepRate, windowSeconds),
        rangeQuery(QUERIES.completedRate, windowSeconds),
      ]);
      return { stepRate, completedRate };
    },
  };
}
