import type { MetricPoint, MetricSeries, ServiceMetrics } from '@lighthouse/shared';

// Thin PromQL client. Returns MetricSeries for the four sparklines the UI needs.
// Queries match build.md §4.

export interface InstantByContainer {
  cpu: Map<string, number>;
  ram: Map<string, number>;
  ramMax: Map<string, number>;
  netIn: Map<string, number>;
  netOut: Map<string, number>;
}

export interface PromClient {
  query: (promql: string) => Promise<number | null>;
  queryRange: (promql: string, startMs: number, endMs: number, stepSec: number) => Promise<MetricPoint[]>;
  serviceMetrics: (containerName: string, rangeSec?: number) => Promise<ServiceMetrics>;
  instantByContainer: () => Promise<InstantByContainer>;
}

export function createPromClient(baseUrl: string): PromClient {
  const root = baseUrl.replace(/\/$/, '');

  async function queryRange(promql: string, startMs: number, endMs: number, stepSec: number): Promise<MetricPoint[]> {
    const url = new URL(`${root}/api/v1/query_range`);
    url.searchParams.set('query', promql);
    url.searchParams.set('start', (startMs / 1000).toFixed(3));
    url.searchParams.set('end', (endMs / 1000).toFixed(3));
    url.searchParams.set('step', String(stepSec));

    const res = await fetch(url);
    if (!res.ok) throw new Error(`prometheus query_range ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as PromRangeResponse;

    if (body.status !== 'success' || body.data.resultType !== 'matrix' || body.data.result.length === 0) {
      return [];
    }
    return body.data.result[0]!.values.map(([t, v]) => ({ t: t * 1000, v: Number(v) }));
  }

  async function query(promql: string): Promise<number | null> {
    const url = new URL(`${root}/api/v1/query`);
    url.searchParams.set('query', promql);
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as PromInstantResponse;
    if (body.status !== 'success' || body.data.result.length === 0) return null;
    return Number(body.data.result[0]!.value[1]);
  }

  async function serviceMetrics(containerName: string, rangeSec = 300): Promise<ServiceMetrics> {
    const end = Date.now();
    const start = end - rangeSec * 1000;
    const step = Math.max(5, Math.floor(rangeSec / 60));
    const selector = `{name=~"${escape(containerName)}"}`;

    const [cpu, ram, netIn, netOut] = await Promise.all([
      queryRange(`rate(container_cpu_usage_seconds_total${selector}[1m]) * 100`, start, end, step),
      queryRange(`container_memory_working_set_bytes${selector} / 1024 / 1024`, start, end, step),
      queryRange(`rate(container_network_receive_bytes_total${selector}[1m])`, start, end, step),
      queryRange(`rate(container_network_transmit_bytes_total${selector}[1m])`, start, end, step),
    ]);

    return {
      cpu: { name: 'cpu_pct', points: cpu },
      ram: { name: 'ram_mb', points: ram },
      netIn: { name: 'net_in_bytes_per_s', points: netIn },
      netOut: { name: 'net_out_bytes_per_s', points: netOut },
    } satisfies ServiceMetrics;
  }

  async function queryByName(promql: string): Promise<Map<string, number>> {
    const url = new URL(`${root}/api/v1/query`);
    url.searchParams.set('query', promql);
    const res = await fetch(url);
    if (!res.ok) return new Map();
    const body = (await res.json()) as PromInstantVectorResponse;
    const out = new Map<string, number>();
    if (body.status !== 'success') return out;
    for (const r of body.data.result) {
      const name = r.metric['name'] ?? r.metric['container_name'] ?? r.metric['container'];
      if (!name) continue;
      const n = Number(r.value[1]);
      if (Number.isFinite(n)) out.set(name, n);
    }
    return out;
  }

  async function instantByContainer(): Promise<InstantByContainer> {
    const [cpu, ram, ramMax, netIn, netOut] = await Promise.all([
      queryByName('rate(container_cpu_usage_seconds_total{name!=""}[1m]) * 100'),
      queryByName('container_memory_working_set_bytes{name!=""} / 1024 / 1024'),
      queryByName('container_spec_memory_limit_bytes{name!=""} / 1024 / 1024'),
      queryByName('sum by (name) (rate(container_network_receive_bytes_total{name!=""}[1m])) / 1024 / 1024'),
      queryByName('sum by (name) (rate(container_network_transmit_bytes_total{name!=""}[1m])) / 1024 / 1024'),
    ]);
    return { cpu, ram, ramMax, netIn, netOut };
  }

  return { query, queryRange, serviceMetrics, instantByContainer };
}

function escape(name: string): string {
  return name.replace(/[\\"]/g, '\\$&');
}

interface PromRangeResponse {
  status: 'success' | 'error';
  data: {
    resultType: 'matrix' | 'vector';
    result: Array<{ metric: Record<string, string>; values: Array<[number, string]> }>;
  };
}

interface PromInstantResponse {
  status: 'success' | 'error';
  data: {
    resultType: 'vector' | 'scalar';
    result: Array<{ metric: Record<string, string>; value: [number, string] }>;
  };
}

interface PromInstantVectorResponse {
  status: 'success' | 'error';
  data: {
    resultType: 'vector';
    result: Array<{ metric: Record<string, string>; value: [number, string] }>;
  };
}
