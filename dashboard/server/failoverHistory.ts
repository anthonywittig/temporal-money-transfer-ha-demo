import type { AsyncOperation, AuditLog, CloudOps } from './cloudOps.js';

const TERMINAL = new Set(['fulfilled', 'failed', 'cancelled', 'rejected']);

/**
 * Finds every failover of the namespace in a recent window, however it was started (this
 * dashboard, the Cloud UI, the CLI, or Temporal's automatic failover), via the audit log.
 * Finished operations are cached so each one is fetched only until it completes.
 */
export class FailoverHistory {
  private readonly finished = new Map<string, AsyncOperation>();

  constructor(
    private readonly audit: AuditLog,
    private readonly cloudOps: CloudOps,
    private readonly namespaceName: string,
  ) {}

  async recent(windowSeconds: number): Promise<AsyncOperation[]> {
    const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const ids = await this.audit.failoverOperationIds(this.namespaceName, since);
    return Promise.all(
      ids.map(async (id) => {
        const cached = this.finished.get(id);
        if (cached) return cached;
        const op = await this.cloudOps.getOperation(id);
        if (TERMINAL.has(op.state)) this.finished.set(id, op);
        return op;
      }),
    );
  }
}

/** The namespace name is the namespace id without its account suffix: "<name>.<account>". */
export function namespaceName(namespaceId: string): string {
  const dot = namespaceId.lastIndexOf('.');
  return dot > 0 ? namespaceId.slice(0, dot) : namespaceId;
}
