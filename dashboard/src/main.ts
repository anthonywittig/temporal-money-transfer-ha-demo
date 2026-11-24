import {
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Legend, Tooltip);

interface HaState {
  activeRegion: string;
  regions: { region: string; state: string; active: boolean }[];
  targetRegion?: string;
  operation?: { id: string; state: string; failureReason?: string };
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

let haState: HaState | undefined;

async function refreshState() {
  const badge = $('active-badge');
  const opStatus = $('op-status');
  const btn = $<HTMLButtonElement>('failover-btn');
  try {
    haState = await api<HaState>('/api/state');
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
        (r) => `<div class="region ${r.active ? 'active' : ''}">
          <div class="name" style="color:${colorFor(r.region)}">${r.region}</div>
          <div class="role">${r.active ? 'ACTIVE, processing' : 'passive, hot standby'} &middot; replica ${r.state}</div>
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

$('failover-btn').addEventListener('click', () => {
  if (!haState?.targetRegion) return;
  $('confirm-text').textContent =
    `Fail the namespace over from ${haState.activeRegion} to ${haState.targetRegion}? ` +
    `In-flight transfers will continue on the ${haState.targetRegion} workers.`;
  $<HTMLDialogElement>('confirm').showModal();
});

$<HTMLDialogElement>('confirm').addEventListener('close', async () => {
  if ($<HTMLDialogElement>('confirm').returnValue !== 'ok') return;
  const status = $('failover-status');
  $<HTMLButtonElement>('failover-btn').disabled = true;
  status.className = 'status';
  status.textContent = 'Requesting failover...';
  try {
    const res = await api<{ targetRegion: string }>('/api/failover', { method: 'POST' });
    status.textContent = `Failover to ${res.targetRegion} requested`;
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
  status.textContent = `Starting ${count}...`;
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

// ---- Charts ----

function makeChart(canvasId: string) {
  return new Chart($<HTMLCanvasElement>(canvasId), {
    type: 'line',
    data: { labels: [], datasets: [] },
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

const stepsChart = makeChart('steps-chart');
const completedChart = makeChart('completed-chart');

function render(chart: Chart, series: Series[]) {
  const times = [...new Set(series.flatMap((s) => s.points.map(([t]) => t)))].sort((a, b) => a - b);
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
    const snap = await api<{ stepRate: Series[]; completedRate: Series[] }>('/api/metrics?window=600');
    render(stepsChart, snap.stepRate);
    render(completedChart, snap.completedRate);
    $('metrics-error').textContent = snap.stepRate.length === 0 ? 'No worker metrics yet.' : '';
  } catch (e) {
    $('metrics-error').textContent = `Metrics error: ${(e as Error).message}`;
  }
}

// ---- Boot ----

api<{ namespace: string; taskQueue: string; pauseSeconds: number }>('/api/info')
  .then((i) => ($('ns-info').textContent = `${i.namespace} · task queue ${i.taskQueue} · pause ${i.pauseSeconds}s`))
  .catch((e) => ($('ns-info').textContent = `Dashboard server error: ${(e as Error).message}`));

refreshState();
refreshInFlight();
refreshMetrics();
setInterval(refreshState, 2000);
setInterval(refreshInFlight, 3000);
setInterval(refreshMetrics, 5000);
