/** Minimal Temporal Cloud Ops API (HTTP) client for the calls the dashboard needs. */

export interface Replica {
  region: string;
  state: string;
}

export interface NamespaceInfo {
  activeRegion: string;
  replicas: Replica[];
  asyncOperationId?: string;
}

export interface AsyncOperation {
  id: string;
  state: string;
  failureReason?: string;
}

export interface CloudOps {
  getNamespace(): Promise<NamespaceInfo>;
  getOperation(id: string): Promise<AsyncOperation>;
  failover(region: string): Promise<AsyncOperation>;
}

export class CloudOpsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

type Fetch = typeof fetch;

export function httpCloudOps(opts: {
  baseUrl: string;
  apiKey: string;
  namespace: string;
  apiVersion?: string;
  fetchImpl?: Fetch;
}): CloudOps {
  const doFetch = opts.fetchImpl ?? fetch;
  const ns = encodeURIComponent(opts.namespace);

  async function call(method: string, path: string, body?: unknown): Promise<any> {
    const headers: Record<string, string> = { Authorization: `Bearer ${opts.apiKey}` };
    if (opts.apiVersion) headers['temporal-cloud-api-version'] = opts.apiVersion;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new CloudOpsError(`Cloud Ops API unreachable (${opts.baseUrl}): ${describeFetchError(e)}`);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new CloudOpsError(`Cloud Ops API ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`, res.status);
    }
    return text ? JSON.parse(text) : {};
  }

  return {
    async getNamespace() {
      const json = await call('GET', `/cloud/namespaces/${ns}`);
      return parseNamespace(json.namespace ?? {});
    },
    async getOperation(id) {
      const json = await call('GET', `/cloud/operations/${encodeURIComponent(id)}`);
      return parseOperation(json.asyncOperation ?? {});
    },
    async failover(region) {
      const json = await call('POST', `/cloud/namespaces/${ns}/failover-region`, { region });
      return parseOperation(json.asyncOperation ?? {});
    },
  };
}

export function parseNamespace(n: any): NamespaceInfo {
  return {
    activeRegion: String(n.activeRegion ?? ''),
    replicas: Array.isArray(n.replicas)
      ? n.replicas.map((r: any) => ({ region: String(r.region ?? ''), state: normalizeEnum(r.state, 'REPLICA_STATE_') }))
      : [],
    asyncOperationId: n.asyncOperationId || undefined,
  };
}

export function parseOperation(o: any): AsyncOperation {
  return {
    id: String(o.id ?? ''),
    state: normalizeEnum(o.state ?? o.stateDeprecated, 'STATE_'),
    failureReason: o.failureReason || undefined,
  };
}

/** Normalizes enum values that may arrive as names ("REPLICA_STATE_ACTIVE") or numbers, to lower-case names ("active"). */
export function normalizeEnum(value: unknown, prefix: string): string {
  if (typeof value === 'number') {
    const replica = ['unspecified', 'adding', 'active', 'removing', 'removed', 'failed'];
    const op = ['unspecified', 'pending', 'in_progress', 'failed', 'cancelled', 'fulfilled', 'rejected'];
    const table = prefix === 'REPLICA_STATE_' ? replica : op;
    return table[value] ?? 'unspecified';
  }
  const s = String(value ?? 'unspecified');
  return (s.startsWith(prefix) ? s.slice(prefix.length) : s).toLowerCase();
}

export function describeFetchError(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  return err.cause?.code ?? err.cause?.message ?? err.message ?? String(e);
}
