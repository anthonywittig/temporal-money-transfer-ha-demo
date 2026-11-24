import { randomUUID } from 'node:crypto';
import { Client, Connection } from '@temporalio/client';

export interface TransferStarter {
  start(count: number): Promise<{ started: number; workflowIds: string[] }>;
  inFlight(): Promise<number>;
}

const ACCOUNTS = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];

/**
 * Starts MoneyTransfer workflows through the Namespace Endpoint with the load-generator key.
 * Start requests are always forwarded to the active region, so this works before and after failover.
 */
export async function temporalTransfers(opts: {
  address: string;
  namespace: string;
  apiKey?: string;
  insecure: boolean;
  taskQueue: string;
  pauseSeconds: number;
}): Promise<TransferStarter> {
  const connection = await Connection.connect({
    address: opts.address,
    tls: !opts.insecure,
    apiKey: opts.apiKey,
  });
  const client = new Client({ connection, namespace: opts.namespace });

  return {
    async start(count) {
      const workflowIds: string[] = [];
      const batch = Array.from({ length: count }, (_, i) => {
        const transferId = randomUUID();
        const workflowId = `transfer-${transferId}`;
        workflowIds.push(workflowId);
        const from = ACCOUNTS[i % ACCOUNTS.length];
        const to = ACCOUNTS[(i + 1) % ACCOUNTS.length];
        return client.workflow.start('MoneyTransfer', {
          taskQueue: opts.taskQueue,
          workflowId,
          args: [{ transferId, fromAccount: from, toAccount: to, amount: 1 + (i % 100), pauseSeconds: opts.pauseSeconds }],
        });
      });
      const results = await Promise.allSettled(batch);
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failures.length > 0) {
        throw new Error(`${failures.length}/${count} starts failed: ${String(failures[0].reason?.message ?? failures[0].reason)}`);
      }
      return { started: count, workflowIds };
    },
    async inFlight() {
      const { count } = await client.workflow.count(`WorkflowType = "MoneyTransfer" AND ExecutionStatus = "Running"`);
      return count;
    },
  };
}
