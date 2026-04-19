import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DockerClient } from '../lib/docker.js';
import type { PromClient } from '../lib/prometheus.js';

interface Deps {
  docker: DockerClient;
  prom: PromClient;
}

const RangeQuery = z.object({
  range: z.string().regex(/^\d+[smh]$/).default('5m'),
});

export async function metricsRoutes(fastify: FastifyInstance, { docker, prom }: Deps) {
  fastify.get('/services/:id/metrics', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const { range } = RangeQuery.parse(req.query);
    const rangeSec = parseRange(range);

    const services = await docker.listServices();
    const svc = services.find((s) => s.id === id);
    if (!svc) return reply.code(404).send({ error: 'not_found' });

    const containerName = svc.id;
    try {
      const metrics = await prom.serviceMetrics(containerName, rangeSec);
      return metrics;
    } catch (err) {
      req.log.warn({ err, containerName }, 'prometheus query failed');
      return reply.code(502).send({ error: 'prometheus_unreachable' });
    }
  });
}

function parseRange(r: string): number {
  const n = parseInt(r.slice(0, -1), 10);
  const unit = r.slice(-1);
  if (unit === 's') return n;
  if (unit === 'm') return n * 60;
  return n * 3600;
}
