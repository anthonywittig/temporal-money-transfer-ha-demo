import {
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type Plugin,
} from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Legend, Tooltip);

interface HaState {
  activeRegion: string;
  regions: { region: string; state: string; active: boolean }[];
  targetRegion?: string;
  operation?: { id: string; state: string; failureReason?: string; startedTime?: string; finishedTime?: string };
  failoverInProgress: boolean;
  blockedReason?: string;
}
interface Series { region: string; points: [number, number][] }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const REGION_COLORS = ['#7c8cff', '#3ecf8e', '#f5b942', '#f2555a'];
const regionColor = new Map<string, string>();
const colorFor = (region: string) => {
  if (!regionColor.has(region)) regionColor.set(region, REGION_COLORS[regionColor.size % REGION_COLORS.length]);
  return regionColor.get(region)!;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

// ---- Active region / failover ----

// Replica state from the Cloud Ops API, worded so it isn't confused with the active region.
const REPLICATION_LABELS: Record<string, string> = { active: 'healthy', adding: 'syncing' };
const replicationLabel = (state: string) => REPLICATION_LABELS[state] ?? state;

let haState: HaState | undefined;

async function refreshState() {
  const badge = $('active-badge');
  const opStatus = $('op-status');
  const btn = $<HTMLButtonElement>('failover-btn');
  try {
    const previousActive = haState?.activeRegion;
    haState = await api<HaState>('/api/state');
    if (previousActive && haState.activeRegion && haState.activeRegion !== previousActive) {
      addMarker(`active: ${haState.activeRegion}`, colorFor(haState.activeRegion));
    }
    markOperation(haState.operation);
    badge.textContent = haState.activeRegion || '-';
    badge.style.background = haState.failoverInProgress ? '' : colorFor(haState.activeRegion);
    badge.classList.toggle('switching', haState.failoverInProgress);
    opStatus.textContent = haState.failoverInProgress
      ? `failover ${haState.operation?.state.replace('_', ' ')}...`
      : haState.operation?.state === 'failed'
        ? `last failover failed: ${haState.operation.failureReason ?? ''}`
        : '';

    btn.disabled = !!haState.blockedReason;
    btn.textContent = haState.targetRegion ? `Fail over to ${haState.targetRegion}` : 'Fail over';
    btn.title = haState.blockedReason ?? '';
    $('failover-status').textContent = haState.blockedReason ?? '';
    $('failover-status').className = 'status';

    $('regions').innerHTML = haState.regions
      .map(
        (r) => `<div class="region ${r.active ? 'active' : ''}" style="--region-color:${colorFor(r.region)}">
          <div class="name">${r.region}</div>
          <div class="role">${r.active ? 'ACTIVE, processing' : 'passive, hot standby'} &middot; replication: ${replicationLabel(r.state)}</div>
        </div>`,
      )
      .join('');
  } catch (e) {
    btn.disabled = true;
    badge.textContent = 'unknown';
    opStatus.textContent = '';
    $('failover-status').textContent = `Cloud Ops API error: ${(e as Error).message}`;
    $('failover-status').className = 'error';
  }
}

$('failover-btn').addEventListener('click', async () => {
  if (!haState?.targetRegion) return;
  const status = $('failover-status');
  $<HTMLButtonElement>('failover-btn').disabled = true;
  status.className = 'status';
  status.textContent = 'Requesting failover...';
  try {
    const res = await api<{ targetRegion: string }>('/api/failover', { method: 'POST' });
    status.textContent = `Failover to ${res.targetRegion} requested`;
    addMarker(`failover clicked \u2192 ${res.targetRegion}`, '#e6e9ef');
  } catch (e) {
    status.className = 'error';
    status.textContent = `Failover rejected: ${(e as Error).message}`;
  }
  refreshState();
});

// ---- Load generation ----

$('start-btn').addEventListener('click', async () => {
  const count = Number($<HTMLInputElement>('count').value);
  const status = $('start-status');
  const btn = $<HTMLButtonElement>('start-btn');
  btn.disabled = true;
  status.className = 'status';
  status.textContent = `Starting ${count}, one per second (about ${count}s)...`;
  try {
    const res = await api<{ started: number }>('/api/transfers', { method: 'POST', body: JSON.stringify({ count }) });
    status.textContent = `Started ${res.started} transfers`;
  } catch (e) {
    status.className = 'error';
    status.textContent = `Start failed: ${(e as Error).message}`;
  } finally {
    btn.disabled = false;
    refreshInFlight();
  }
});

async function refreshInFlight() {
  try {
    const { inFlight } = await api<{ inFlight: number }>('/api/inflight');
    $('inflight').textContent = String(inFlight);
    $('inflight-error').textContent = '';
  } catch (e) {
    $('inflight').textContent = '?';
    $('inflight-error').textContent = `Temporal error: ${(e as Error).message}`;
  }
}

// Failovers started anywhere (Cloud UI, CLI, automatic), from the audit log. Needs TEMPORAL_AUDIT_API_KEY;
// without it the server reports enabled: false and only this dashboard's own failovers get op lines.
async function refreshFailovers() {
  try {
    const { failovers } = await api<{ enabled: boolean; failovers: NonNullable<HaState['operation']>[] }>(
      '/api/failovers?window=600',
    );
    failovers.forEach(markOperation);
  } catch {
    // Best effort: markers are a nice-to-have, and /api/state still marks this dashboard's failovers.
  }
}

// Transfers whose withdraw and deposit ran in different regions (CrossRegion search attribute).
// The number links to the same search in the Temporal Cloud UI, newest first.
async function refreshCrossed() {
  try {
    const { crossed } = await api<{ crossed: number }>('/api/crossed?window=600');
    $('crossed').textContent = String(crossed);
    $('crossed-error').textContent = '';
  } catch (e) {
    $('crossed').textContent = '?';
    $('crossed-error').textContent = `Temporal error: ${(e as Error).message}`;
  }
}

// ---- Charts ----

// Vertical markers for "failover clicked" and "active region switched", kept for the session.
interface Marker { t: number; label: string; color: string }
const markers: Marker[] = [];
const chartTimes = new WeakMap<Chart, number[]>();

const markerPlugin: Plugin<'line'> = {
  id: 'markers',
  afterDatasetsDraw(chart) {
    const times = chartTimes.get(chart as Chart);
    if (!times || times.length < 2) return;
    const { ctx, chartArea, scales } = chart;
    markers.forEach((m, n) => {
      if (m.t < times[0] || m.t > times[times.length - 1]) return;
      // The x axis is a category scale of sample times, so interpolate between the two neighbours.
      const i = Math.max(1, times.findIndex((t) => t >= m.t));
      const frac = (m.t - times[i - 1]) / (times[i] - times[i - 1] || 1);
      const x = scales.x.getPixelForValue(i - 1) + frac * (scales.x.getPixelForValue(i) - scales.x.getPixelForValue(i - 1));
      ctx.save();
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = m.color;
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(m.label, x + 4, chartArea.top + 12 + (n % 4) * 14); // stagger rows so close labels don't overlap
      ctx.restore();
    });
  },
};

function addMarker(label: string, color: string, t = Date.now() / 1000) {
  markers.push({ t, label, color });
  totalChart.update();
}

// Temporal Cloud's own start/finish times for the failover operation, added once each per operation.
const OP_COLOR = '#f5b942';
const markedOps = new Set<string>();
function markOperation(op?: HaState['operation']) {
  if (!op?.id) return;
  for (const [kind, iso] of [['started', op.startedTime], ['finished', op.finishedTime]] as const) {
    const key = `${op.id}:${kind}`;
    const t = iso ? Date.parse(iso) / 1000 : NaN;
    if (markedOps.has(key) || Number.isNaN(t)) continue;
    markedOps.add(key);
    addMarker(kind === 'started' ? 'op started' : `op ${op.state}`, OP_COLOR, t);
  }
}

function makeChart(canvasId: string) {
  return new Chart($<HTMLCanvasElement>(canvasId), {
    type: 'line',
    data: { labels: [], datasets: [] },
    plugins: [markerPlugin],
    options: {
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { color: '#8a93a6', maxTicksLimit: 8 }, grid: { color: '#262c38' } },
        y: { beginAtZero: true, ticks: { color: '#8a93a6' }, grid: { color: '#262c38' } },
      },
      plugins: { legend: { labels: { color: '#e6e9ef' } } },
    },
  });
}

const totalChart = makeChart('total-chart');

function render(chart: Chart, series: Series[]) {
  const times = [...new Set(series.flatMap((s) => s.points.map(([t]) => t)))].sort((a, b) => a - b);
  chartTimes.set(chart, times);
  chart.data.labels = times.map((t) => new Date(t * 1000).toLocaleTimeString());
  chart.data.datasets = series
    .sort((a, b) => a.region.localeCompare(b.region))
    .map((s) => {
      const byTime = new Map(s.points);
      return {
        label: s.region,
        data: times.map((t) => byTime.get(t) ?? 0),
        borderColor: colorFor(s.region),
        backgroundColor: colorFor(s.region),
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.2,
      };
    });
  chart.update();
}

async function refreshMetrics() {
  try {
    const snap = await api<{ totalStepRate: Series[] }>('/api/metrics?window=600');
    render(totalChart, snap.totalStepRate);
    $('metrics-error').textContent = snap.totalStepRate.length === 0 ? 'No worker metrics yet.' : '';
  } catch (e) {
    $('metrics-error').textContent = `Metrics error: ${(e as Error).message}`;
  }
}

// ---- Boot ----

api<{ namespace: string; taskQueue: string }>('/api/info')
  .then((i) => {
    $('ns-info').textContent = `${i.namespace} · task queue ${i.taskQueue} · one start per second · each transfer: wait 1 s, withdraw, wait 10 s, deposit`;
    const query = 'WorkflowType = "MoneyTransfer" AND CrossRegion = true';
    $<HTMLAnchorElement>('crossed').href =
      `https://cloud.temporal.io/namespaces/${encodeURIComponent(i.namespace)}/workflows?query=${encodeURIComponent(query)}`;
  })
  .catch((e) => ($('ns-info').textContent = `Dashboard server error: ${(e as Error).message}`));

refreshFailovers();
refreshCrossed();
refreshState();
refreshInFlight();
refreshMetrics();
setInterval(refreshState, 2000);
setInterval(refreshInFlight, 3000);
setInterval(refreshCrossed, 5000);
setInterval(refreshFailovers, 5000);
setInterval(refreshMetrics, 5000);
