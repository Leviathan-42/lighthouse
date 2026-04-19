import Docker from 'dockerode';
import type { Service, ServiceStatus } from '@lighthouse/shared';

export interface LiveStats {
  cpuPct: number;
  ramMb: number;
  ramMaxMb: number;
  netInBytes: number;
  netOutBytes: number;
}

export interface DockerClient {
  ping: () => Promise<boolean>;
  listServices: () => Promise<Service[]>;
  containerStats: (id: string) => Promise<LiveStats | null>;
  restartContainer: (id: string) => Promise<void>;
  raw: Docker;
}

export function createDockerClient(socketPath: string): DockerClient {
  const docker = new Docker({ socketPath });

  const ping = async (): Promise<boolean> => {
    try {
      await docker.ping();
      return true;
    } catch {
      return false;
    }
  };

  const listServices = async (): Promise<Service[]> => {
    const containers = await docker.listContainers({ all: true });
    const base = containers.map(containerToService);
    // Enrich running containers with live Docker-API stats in parallel. Skip
    // non-running ones (stats endpoint blocks on them).
    await Promise.all(
      base.map(async (svc) => {
        if (svc.status !== 'ok' && svc.status !== 'warn' && svc.status !== 'deploying') return;
        if (!svc.container) return;
        const stats = await containerStats(svc.container).catch(() => null);
        if (!stats) return;
        svc.cpu = stats.cpuPct;
        svc.ram = stats.ramMb;
        svc.ramMax = stats.ramMaxMb || svc.ramMax;
        svc.netIn = stats.netInBytes / 1024 / 1024;
        svc.netOut = stats.netOutBytes / 1024 / 1024;
      }),
    );
    return base;
  };

  const containerStats = async (id: string): Promise<LiveStats | null> => {
    try {
      const raw = (await docker.getContainer(id).stats({ stream: false })) as unknown as DockerStats;
      return projectStats(raw);
    } catch {
      return null;
    }
  };

  const restartContainer = async (id: string): Promise<void> => {
    await docker.getContainer(id).restart();
  };

  return { ping, listServices, containerStats, restartContainer, raw: docker };
}

interface DockerStats {
  cpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  memory_stats?: { usage?: number; limit?: number; stats?: { cache?: number; inactive_file?: number } };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
}

function projectStats(s: DockerStats): LiveStats {
  // Docker API returns cumulative counters; CPU% is derived from the delta
  // between `cpu_stats` and `precpu_stats` (the sample taken ~1s before).
  const cpuDelta = (s.cpu_stats?.cpu_usage?.total_usage ?? 0) - (s.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const systemDelta = (s.cpu_stats?.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0);
  const onlineCpus = s.cpu_stats?.online_cpus ?? 1;
  const cpuPct = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : 0;

  // Subtract page cache so the number matches `docker stats`' "Mem Usage" column.
  const usage = s.memory_stats?.usage ?? 0;
  const cache = s.memory_stats?.stats?.inactive_file ?? s.memory_stats?.stats?.cache ?? 0;
  const memBytes = Math.max(0, usage - cache);
  const ramMb = Math.round(memBytes / 1024 / 1024);
  const ramMaxMb = Math.round((s.memory_stats?.limit ?? 0) / 1024 / 1024);

  let netIn = 0;
  let netOut = 0;
  for (const iface of Object.values(s.networks ?? {})) {
    netIn += iface.rx_bytes ?? 0;
    netOut += iface.tx_bytes ?? 0;
  }

  return {
    cpuPct: Math.round(cpuPct * 10) / 10,
    ramMb,
    ramMaxMb,
    netInBytes: netIn,
    netOutBytes: netOut,
  };
}

// Maps a Docker container summary to a Lighthouse Service. Metrics (cpu, ram, net)
// and sparklines are zero here — they come from Prometheus in step 5.
function containerToService(c: Docker.ContainerInfo): Service {
  const name = (c.Names[0] || '').replace(/^\//, '') || c.Id.slice(0, 12);
  const labels = c.Labels || {};
  const category = labels['lighthouse.category'] ?? 'app';
  const host = labels['lighthouse.host'] ?? `${name}.local`;
  const alert = labels['lighthouse.alert'] || undefined;
  const tagStr = labels['lighthouse.tags'];
  const tags = tagStr ? tagStr.split(',').map((t) => t.trim()).filter(Boolean) : [];

  const status = mapState(c.State, c.Status);
  const uptime = deriveUptime(c.Created, status);
  const version = extractVersion(c.Image);

  return {
    id: name,
    name,
    slug: name,
    category,
    host,
    status,
    uptime,
    version,
    cpu: 0,
    ram: 0,
    ramMax: 0,
    netIn: 0,
    netOut: 0,
    container: c.Id.slice(0, 12),
    image: c.Image,
    cpuSpark: [],
    ramSpark: [],
    tags,
    ...(alert ? { alert } : {}),
  };
}

function mapState(state: string, status: string): ServiceStatus {
  if (state === 'running') {
    // "Up 3 hours (unhealthy)" — treat unhealthy as warn
    if (/unhealthy/i.test(status)) return 'warn';
    return 'ok';
  }
  if (state === 'exited') {
    return /Exited \((?!0\))/.test(status) ? 'error' : 'idle';
  }
  if (state === 'created' || state === 'paused') return 'idle';
  if (state === 'restarting') return 'deploying';
  if (state === 'dead') return 'error';
  return 'idle';
}

function deriveUptime(createdUnix: number, status: ServiceStatus): string {
  if (status === 'idle' || status === 'error') return '—';
  const ageSec = Math.max(0, Math.floor(Date.now() / 1000 - createdUnix));
  const d = Math.floor(ageSec / 86400);
  const h = Math.floor((ageSec % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((ageSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function extractVersion(image: string): string {
  const colon = image.lastIndexOf(':');
  if (colon === -1 || colon < image.lastIndexOf('/')) return 'latest';
  return image.slice(colon + 1);
}
