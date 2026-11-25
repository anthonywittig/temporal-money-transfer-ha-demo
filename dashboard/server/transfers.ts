import { randomUUID } from 'node:crypto';
import { Client, Connection } from '@temporalio/client';

export interface TransferStarter {
  start(count: number): Promise<{ started: number; workflowIds: string[] }>;
  inFlight(): Promise<number>;
  /** Transfers that closed in the last `windowSeconds` with the withdraw and deposit in different regions. */
  crossedRegions(windowSeconds: number): Promise<number>;
}

const ACCOUNTS = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
const START_INTERVAL_MS = 1000;

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
}): Promise<TransferStarter> {
  const connection = await Connection.connect({
    address: opts.address,
    tls: !opts.insecure,
    apiKey: opts.apiKey,
  });
  const client = new Client({ connection, namespace: opts.namespace });

  return {
    async start(count) {
      // Starts one transfer per second. Each withdraws right away, waits 10s, then deposits, so steps
      // stream in at about one per second with deposits trailing withdraws by 10s. A failed start
      // (e.g. mid-failover) doesn't stop the batch; failures are reported once all have been tried.
      const workflowIds: string[] = [];
      const errors: string[] = [];
      for (let i = 0; i < count; i++) {
        if (i > 0) await new Promise((resolve) => setTimeout(resolve, START_INTERVAL_MS));
        const transferId = randomUUID();
        const n = i + 1;
        const workflowId = `transfer-${n}-${transferId}`;
        const from = ACCOUNTS[i % ACCOUNTS.length];
        const to = ACCOUNTS[(i + 1) % ACCOUNTS.length];
        try {
          await client.workflow.start('MoneyTransfer', {
            taskQueue: opts.taskQueue,
            workflowId,
            args: [{ transferId, fromAccount: from, toAccount: to, amount: 1 + (i % 100) }],
          });
          workflowIds.push(workflowId);
        } catch (e) {
          errors.push(`${workflowId}: ${(e as Error).message ?? String(e)}`);
        }
      }
      if (errors.length > 0) {
        throw new Error(`${errors.length}/${count} starts failed (${workflowIds.length} started): ${errors[0]}`);
      }
      return { started: count, workflowIds };
    },
    async inFlight() {
      const { count } = await client.workflow.count(`WorkflowType = "MoneyTransfer" AND ExecutionStatus = "Running"`);
      return count;
    },
    async crossedRegions(windowSeconds) {
      // CrossRegion is a custom search attribute the workflow sets after the deposit.
      const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
      const { count } = await client.workflow.count(
        `WorkflowType = "MoneyTransfer" AND CrossRegion = true AND CloseTime > "${since}"`,
      );
      return count;
    },
  };
}
