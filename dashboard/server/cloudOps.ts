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
  /** When Temporal Cloud started and finished the operation (ISO 8601), if reported. */
  startedTime?: string;
  finishedTime?: string;
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

interface CallerOptions {
  baseUrl: string;
  apiKey: string;
  apiVersion?: string;
  fetchImpl?: Fetch;
}

/** Authenticated JSON call to the Cloud Ops HTTP API. Errors become CloudOpsError. */
function cloudOpsCaller(opts: CallerOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  return async function call(method: string, path: string, body?: unknown): Promise<any> {
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
  };
}

export function httpCloudOps(opts: CallerOptions & { namespace: string }): CloudOps {
  const call = cloudOpsCaller(opts);
  const ns = encodeURIComponent(opts.namespace);

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
    startedTime: o.startedTime || undefined,
    finishedTime: o.finishedTime || undefined,
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

/** Reads the account audit log. Needs a key that may list audit logs (Global Admin or Account Owner). */
export interface AuditLog {
  /** IDs of failover operations on `namespaceName` recorded since `sinceIso`, oldest first. */
  failoverOperationIds(namespaceName: string, sinceIso: string): Promise<string[]>;
}

const AUDIT_PAGE_SIZE = 200;
const AUDIT_MAX_PAGES = 5;

export function httpAuditLog(opts: CallerOptions): AuditLog {
  const call = cloudOpsCaller(opts);
  return {
    async failoverOperationIds(namespaceName, sinceIso) {
      const ids: string[] = [];
      let pageToken = '';
      for (let page = 0; page < AUDIT_MAX_PAGES; page++) {
        const params = new URLSearchParams({ startTimeInclusive: sinceIso, pageSize: String(AUDIT_PAGE_SIZE) });
        if (pageToken) params.set('pageToken', pageToken);
        const json = await call('GET', `/cloud/audit-logs?${params}`);
        ids.push(...parseFailoverAuditLogs(json.logs ?? [], namespaceName));
        pageToken = json.nextPageToken ?? '';
        if (!pageToken) break;
      }
      return [...new Set(ids)];
    },
  };
}

/** Picks the async operation IDs of FailoverNamespace entries for one namespace, oldest first. */
export function parseFailoverAuditLogs(logs: any[], namespaceName: string): string[] {
  return logs
    .filter((l) => l?.operation === 'FailoverNamespace' && l?.asyncOperationId)
    .filter((l) => {
      const details = typeof l.rawDetails === 'string' ? safeJson(l.rawDetails) : l.rawDetails;
      return details?.namespace === namespaceName;
    })
    .sort((a, b) => String(a.emitTime ?? '').localeCompare(String(b.emitTime ?? '')))
    .map((l) => String(l.asyncOperationId));
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
