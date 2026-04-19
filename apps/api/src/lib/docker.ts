import Docker from 'dockerode';
import type { Service, ServiceStatus } from '@lighthouse/shared';

export interface DockerClient {
  ping: () => Promise<boolean>;
  listServices: () => Promise<Service[]>;
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
    return containers.map(containerToService);
  };

  const restartContainer = async (id: string): Promise<void> => {
    await docker.getContainer(id).restart();
  };

  return { ping, listServices, restartContainer, raw: docker };
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
