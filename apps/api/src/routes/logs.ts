import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DockerClient } from '../lib/docker.js';
import type { LokiClient } from '../lib/loki.js';
import type { LogLevel } from '@lighthouse/shared';
import { openSse } from '../lib/sse.js';

interface Deps {
  docker: DockerClient;
  loki: LokiClient;
}

const LogQuery = z.object({
  level: z.enum(['info', 'warn', 'error', 'debug']).optional(),
  since: z.string().optional(),
  tail: z.coerce.number().int().positive().max(1000).default(200),
});

export async function logRoutes(fastify: FastifyInstance, { docker, loki }: Deps) {
  fastify.get('/services/:id/logs', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const query = LogQuery.parse(req.query);

    const services = await docker.listServices();
    const svc = services.find((s) => s.id === id);
    if (!svc || !svc.container) return reply.code(404).send({ error: 'not_found' });

    // Accept: text/event-stream → stream via SSE. Otherwise return last N as JSON.
    const accept = String(req.headers['accept'] || '');
    const wantsStream = accept.includes('text/event-stream');

    const logql = buildLogql(svc.id, query.level);

    if (!wantsStream) {
      try {
        const lines = await loki.queryRange(logql, { limit: query.tail, direction: 'backward' });
        return lines.reverse();
      } catch (err) {
        req.log.warn({ err }, 'loki query failed, falling back to docker logs');
        return fallbackDockerLogs(docker, svc.container, query.tail);
      }
    }

    const stream = openSse(req, reply);
    let lastNs = BigInt(Date.now()) * 1_000_000n;

    // Backfill
    try {
      const initial = await loki.queryRange(logql, { limit: Math.min(query.tail, 500), direction: 'backward' });
      for (const line of initial.reverse()) stream.send('log', line);
    } catch {
      /* ignore — live tail may still work */
    }

    const timer = setInterval(async () => {
      try {
        const now = BigInt(Date.now()) * 1_000_000n;
        const lines = await loki.queryRange(logql, {
          startNs: Number(lastNs),
          endNs: Number(now),
          limit: 500,
          direction: 'forward',
        });
        if (lines.length > 0) {
          for (const line of lines) stream.send('log', line);
          lastNs = now;
        }
      } catch {
        /* swallow — next tick may succeed */
      }
    }, 1000);

    stream.onClose(() => clearInterval(timer));
  });
}

function buildLogql(container: string, level: LogLevel | undefined): string {
  const base = `{container="${container}"}`;
  if (!level) return base;
  return `${base} |~ "(?i)${level}"`;
}

async function fallbackDockerLogs(docker: DockerClient, containerId: string, tail: number) {
  const container = docker.raw.getContainer(containerId);
  const buffer = await container.logs({ stdout: true, stderr: true, tail, timestamps: true });
  const raw = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer);
  // Docker log frames have an 8-byte header we'd need to strip for clean output;
  // for a simple fallback we just split lines and drop obvious control bytes.
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const cleaned = line.replace(/[\x00-\x08\x0b-\x1f]+/g, '');
      const match = cleaned.match(/^(\S+)\s+(.*)$/);
      const t = match ? match[1].slice(11, 23) : '';
      const msg = match ? match[2] : cleaned;
      return { t, lvl: 'info' as const, msg };
    });
}
