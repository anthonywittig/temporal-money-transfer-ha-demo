import { describe, expect, it } from 'vitest';
import { parseFailoverAuditLogs, type AsyncOperation, type AuditLog, type CloudOps } from '../server/cloudOps.js';
import { FailoverHistory, namespaceName } from '../server/failoverHistory.js';

const NS = 'ajw-ha-demo';

describe('parseFailoverAuditLogs', () => {
  it('keeps only FailoverNamespace entries for this namespace, oldest first', () => {
    const logs = [
      { operation: 'FailoverNamespace', asyncOperationId: 'b', emitTime: '2026-01-01T00:02:00Z', rawDetails: { namespace: NS } },
      { operation: 'FailoverNamespace', asyncOperationId: 'x', emitTime: '2026-01-01T00:01:30Z', rawDetails: { namespace: 'other' } },
      { operation: 'UpdateNamespace', asyncOperationId: 'y', emitTime: '2026-01-01T00:01:00Z', rawDetails: { namespace: NS } },
      { operation: 'FailoverNamespace', asyncOperationId: 'a', emitTime: '2026-01-01T00:01:00Z', rawDetails: JSON.stringify({ namespace: NS }) },
    ];
    expect(parseFailoverAuditLogs(logs, NS)).toEqual(['a', 'b']);
  });
});

describe('FailoverHistory', () => {
  it('fetches each operation until it finishes, then serves it from cache', async () => {
    const ops: Record<string, AsyncOperation> = {
      done: { id: 'done', state: 'fulfilled', startedTime: 't0', finishedTime: 't1' },
      running: { id: 'running', state: 'in_progress', startedTime: 't2' },
    };
    const fetched: string[] = [];
    const audit: AuditLog = { failoverOperationIds: async () => ['done', 'running'] };
    const cloudOps = {
      getOperation: async (id: string) => {
        fetched.push(id);
        return ops[id];
      },
    } as unknown as CloudOps;

    const history = new FailoverHistory(audit, cloudOps, NS);
    expect(await history.recent(600)).toEqual([ops.done, ops.running]);
    await history.recent(600);

    expect(fetched).toEqual(['done', 'running', 'running']);
  });

  it('derives the namespace name from the namespace id', () => {
    expect(namespaceName('ajw-2026-11-ha-demo.sdvdw')).toBe('ajw-2026-11-ha-demo');
  });
});
