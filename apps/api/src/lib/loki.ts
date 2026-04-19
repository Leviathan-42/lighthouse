import type { LogLevel, LogLine } from '@lighthouse/shared';

// Loki client — range queries + tail polling. We don't use Loki's websocket
// endpoint; HTTP poll is simpler and a homelab workload doesn't need the extra throughput.

export interface LokiClient {
  queryRange: (logql: string, opts?: QueryRangeOpts) => Promise<LogLine[]>;
  ready: () => Promise<boolean>;
}

export interface QueryRangeOpts {
  startNs?: number;
  endNs?: number;
  limit?: number;
  direction?: 'forward' | 'backward';
}

export function createLokiClient(baseUrl: string): LokiClient {
  const root = baseUrl.replace(/\/$/, '');

  async function queryRange(logql: string, opts: QueryRangeOpts = {}): Promise<LogLine[]> {
    const url = new URL(`${root}/loki/api/v1/query_range`);
    url.searchParams.set('query', logql);
    if (opts.limit) url.searchParams.set('limit', String(opts.limit));
    if (opts.direction) url.searchParams.set('direction', opts.direction);
    if (opts.startNs) url.searchParams.set('start', String(opts.startNs));
    if (opts.endNs) url.searchParams.set('end', String(opts.endNs));

    const res = await fetch(url);
    if (!res.ok) throw new Error(`loki query_range ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as LokiQueryResponse;

    if (body.status !== 'success') return [];
    const lines: LogLine[] = [];
    for (const stream of body.data.result) {
      const streamLevel = stream.stream['level'];
      for (const [tsNs, raw] of stream.values) {
        const t = formatTimestamp(Number(tsNs));
        const lvl = inferLevel(streamLevel, raw);
        lines.push({ t, lvl, msg: raw });
      }
    }
    lines.sort((a, b) => a.t.localeCompare(b.t));
    return lines;
  }

  async function ready(): Promise<boolean> {
    try {
      const res = await fetch(`${root}/ready`);
      return res.ok;
    } catch {
      return false;
    }
  }

  return { queryRange, ready };
}

function formatTimestamp(ns: number): string {
  const ms = Math.floor(ns / 1e6);
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

function inferLevel(streamLevel: string | undefined, raw: string): LogLevel {
  if (streamLevel === 'error' || streamLevel === 'warn' || streamLevel === 'info' || streamLevel === 'debug') {
    return streamLevel;
  }
  if (/\b(error|panic|fatal)\b/i.test(raw)) return 'error';
  if (/\b(warn|warning)\b/i.test(raw)) return 'warn';
  return 'info';
}

interface LokiQueryResponse {
  status: 'success' | 'error';
  data: {
    resultType: 'streams' | 'matrix' | 'vector';
    result: Array<{ stream: Record<string, string>; values: Array<[string, string]> }>;
  };
}
