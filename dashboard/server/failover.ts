import type { AsyncOperation, CloudOps, NamespaceInfo } from './cloudOps.js';

const TERMINAL = new Set(['fulfilled', 'failed', 'cancelled', 'rejected']);

export interface HaState {
  activeRegion: string;
  regions: { region: string; state: string; active: boolean }[];
  /** The region a failover would move to, if any. */
  targetRegion?: string;
  operation?: AsyncOperation;
  failoverInProgress: boolean;
  /** Why a failover can't be triggered right now, if it can't. */
  blockedReason?: string;
}

/**
 * Tracks the namespace's HA state and triggers failovers to whichever region is not active.
 * Failovers are refused while one is in progress or when the target replica isn't ready.
 */
export class FailoverService {
  private lastOperationId?: string;

  constructor(private readonly cloudOps: CloudOps) {}

  async state(): Promise<HaState> {
    const ns = await this.cloudOps.getNamespace();
    // Prefer the failover this dashboard started (so the UI can show its progress and result);
    // otherwise report whatever operation the namespace says is running.
    const opId = this.lastOperationId ?? ns.asyncOperationId;
    const operation = opId ? await this.cloudOps.getOperation(opId) : undefined;
    if (operation && TERMINAL.has(operation.state) && ns.asyncOperationId && ns.asyncOperationId !== opId) {
      // Our operation finished but another one is now running on the namespace: report that one.
      return describe(ns, await this.cloudOps.getOperation(ns.asyncOperationId));
    }
    return describe(ns, operation);
  }

  async failover(): Promise<{ targetRegion: string; operation: AsyncOperation }> {
    const current = await this.state();
    if (current.blockedReason || !current.targetRegion) {
      throw new FailoverRejected(current.blockedReason ?? 'no failover target');
    }
    const operation = await this.cloudOps.failover(current.targetRegion);
    if (operation.id) this.lastOperationId = operation.id;
    return { targetRegion: current.targetRegion, operation };
  }
}

export class FailoverRejected extends Error {}

export function describe(ns: NamespaceInfo, operation?: AsyncOperation): HaState {
  const regions = ns.replicas.map((r) => ({ ...r, active: r.region === ns.activeRegion }));
  const others = regions.filter((r) => !r.active);
  const failoverInProgress = operation !== undefined && !TERMINAL.has(operation.state);

  let blockedReason: string | undefined;
  const target = others[0];
  if (!ns.activeRegion) blockedReason = 'namespace has no active region';
  else if (others.length === 0) blockedReason = 'namespace has no replica region';
  else if (others.length > 1) blockedReason = `expected one replica region, found ${others.length}`;
  else if (failoverInProgress) blockedReason = `an operation is in progress (${operation!.state})`;
  else if (target.state !== 'active') blockedReason = `replica ${target.region} is not ready (state: ${target.state})`;

  return {
    activeRegion: ns.activeRegion,
    regions,
    targetRegion: others.length === 1 ? target.region : undefined,
    operation,
    failoverInProgress,
    blockedReason,
  };
}
