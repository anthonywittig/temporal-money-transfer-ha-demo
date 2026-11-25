import { describe as suite, expect, it } from 'vitest';
import { buildApp } from '../server/app.js';
import { httpCloudOps, type AsyncOperation, type CloudOps, type NamespaceInfo } from '../server/cloudOps.js';
import { FailoverService } from '../server/failover.js';

const EAST = 'gcp-us-east4';
const CENTRAL = 'gcp-us-central1';

/** In-memory fake of the Cloud Ops API that behaves like a real HA namespace. */
class FakeCloudOps implements CloudOps {
  active = EAST;
  replicaState: Record<string, string> = { [EAST]: 'active', [CENTRAL]: 'active' };
  ops = new Map<string, AsyncOperation>();
  nsOpId?: string;
  failoverCalls: string[] = [];

  async getNamespace(): Promise<NamespaceInfo> {
    return {
      activeRegion: this.active,
      replicas: [EAST, CENTRAL].map((region) => ({ region, state: this.replicaState[region] })),
      asyncOperationId: this.nsOpId,
    };
  }
  async getOperation(id: string) {
    const op = this.ops.get(id);
    if (!op) throw new Error(`unknown op ${id}`);
    return op;
  }
  async failover(region: string) {
    this.failoverCalls.push(region);
    const op = { id: `op-${this.failoverCalls.length}`, state: 'in_progress' };
    this.ops.set(op.id, op);
    this.nsOpId = op.id;
    return op;
  }
  complete(opId: string) {
    this.ops.set(opId, { id: opId, state: 'fulfilled' });
    this.active = this.active === EAST ? CENTRAL : EAST;
    this.nsOpId = undefined;
  }
}

function appWith(cloudOps: CloudOps) {
  return buildApp({
    failover: new FailoverService(cloudOps),
    metrics: { snapshot: async () => ({ totalStepRate: [] }) },
    transfers: { start: async (n) => ({ started: n, workflowIds: [] }), inFlight: async () => 0, crossedRegions: async () => 0 },
    info: { namespace: 'ns.acct', taskQueue: 'money-transfer' },
    logger: false,
  });
}

suite('POST /api/failover', () => {
  it('fails over to the replica region, then back again', async () => {
    const fake = new FakeCloudOps();
    const app = appWith(fake);

    const first = await app.inject({ method: 'POST', url: '/api/failover' });
    expect(first.statusCode).toBe(200);
    expect(first.json().targetRegion).toBe(CENTRAL);
    fake.complete('op-1');

    const state = (await app.inject({ method: 'GET', url: '/api/state' })).json();
    expect(state.activeRegion).toBe(CENTRAL);
    expect(state.targetRegion).toBe(EAST);
    expect(state.failoverInProgress).toBe(false);
    expect(state.blockedReason).toBeUndefined();

    const second = await app.inject({ method: 'POST', url: '/api/failover' });
    expect(second.statusCode).toBe(200);
    expect(second.json().targetRegion).toBe(EAST);
    expect(fake.failoverCalls).toEqual([CENTRAL, EAST]);
  });

  it('refuses while a failover is in progress', async () => {
    const fake = new FakeCloudOps();
    const app = appWith(fake);
    await app.inject({ method: 'POST', url: '/api/failover' });

    const again = await app.inject({ method: 'POST', url: '/api/failover' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatch(/in progress/);
    expect(fake.failoverCalls).toHaveLength(1);

    const state = (await app.inject({ method: 'GET', url: '/api/state' })).json();
    expect(state.failoverInProgress).toBe(true);
  });

  it('refuses when the replica is not ready', async () => {
    const fake = new FakeCloudOps();
    fake.replicaState[CENTRAL] = 'adding';
    const app = appWith(fake);

    const res = await app.inject({ method: 'POST', url: '/api/failover' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/not ready/);
    expect(fake.failoverCalls).toHaveLength(0);
  });

  it('refuses when an operation started elsewhere is running on the namespace', async () => {
    const fake = new FakeCloudOps();
    fake.ops.set('external', { id: 'external', state: 'pending' });
    fake.nsOpId = 'external';
    const res = await appWith(fake).inject({ method: 'POST', url: '/api/failover' });
    expect(res.statusCode).toBe(409);
    expect(fake.failoverCalls).toHaveLength(0);
  });

  it('surfaces Cloud Ops API errors', async () => {
    const fake = new FakeCloudOps();
    fake.getNamespace = async () => {
      throw new Error('Cloud Ops API GET failed: 403 forbidden');
    };
    const res = await appWith(fake).inject({ method: 'GET', url: '/api/state' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/403/);
  });
});

suite('httpCloudOps', () => {
  it('sends the key, parses enum names, and posts the failover body', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = url.endsWith('/failover-region')
        ? { asyncOperation: { id: 'op-9', state: 'STATE_PENDING' } }
        : {
            namespace: {
              activeRegion: EAST,
              replicas: [
                { region: EAST, state: 'REPLICA_STATE_ACTIVE' },
                { region: CENTRAL, state: 'REPLICA_STATE_ACTIVE' },
              ],
            },
          };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const ops = httpCloudOps({ baseUrl: 'https://api.test', apiKey: 'k', namespace: 'ns.acct', fetchImpl });
    const ns = await ops.getNamespace();
    expect(ns.replicas.map((r) => r.state)).toEqual(['active', 'active']);
    const op = await ops.failover(CENTRAL);
    expect(op).toEqual({ id: 'op-9', state: 'pending', failureReason: undefined });

    expect(calls[0].url).toBe('https://api.test/cloud/namespaces/ns.acct');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(calls[1].init.method).toBe('POST');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ region: CENTRAL });
  });
});

suite('POST /api/transfers', () => {
  it('validates the batch size', async () => {
    const app = appWith(new FakeCloudOps());
    expect((await app.inject({ method: 'POST', url: '/api/transfers', payload: { count: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/transfers', payload: { count: 50 } })).json().started).toBe(50);
  });
});
