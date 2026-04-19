import type {
  Deploy,
  DeployEvent,
  LogLine,
  Service,
  ServiceMetrics,
  TailnetNode,
} from '@lighthouse/shared';

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`HTTP ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* ignore */ }
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

export const api = {
  services: () => request<Service[]>('/services'),
  service: (id: string) => request<Service>(`/services/${id}`),
  serviceMetrics: (id: string, range = '5m') => request<ServiceMetrics>(`/services/${id}/metrics?range=${range}`),
  serviceLogs: (id: string, tail = 200) => request<LogLine[]>(`/services/${id}/logs?tail=${tail}`),
  restartService: (id: string) => request<{ ok: true }>(`/services/${id}/restart`, { method: 'POST' }),
  redeployService: (id: string, body: { branch?: string; sha?: string } = {}) =>
    request<{ id: string }>(`/services/${id}/redeploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  tailnetDevices: () => request<TailnetNode[]>('/tailnet/devices'),
  tailnetDevice: (id: string) => request<TailnetNode>(`/tailnet/devices/${id}`),

  deploys: (limit = 50) => request<Deploy[]>(`/deploys?limit=${limit}`),
  deploy: (id: string) => request<Deploy>(`/deploys/${id}`),
  deployEvents: (id: string) => request<DeployEvent[]>(`/deploys/${id}/events`),
  rollbackDeploy: (id: string) => request<{ id: string }>(`/deploys/${id}/rollback`, { method: 'POST' }),
  cancelDeploy: (id: string) => request<{ ok: true }>(`/deploys/${id}/cancel`, { method: 'POST' }),
};

export function sseUrl(path: string): string {
  return `${API_BASE}${path}`;
}
