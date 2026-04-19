import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DockerClient } from '../lib/docker.js';

interface Deps {
  docker: DockerClient;
}

const IdParams = z.object({ id: z.string().min(1) });

export async function serviceRoutes(fastify: FastifyInstance, { docker }: Deps) {
  // CPU/RAM/net are enriched in docker.listServices() via Docker's own
  // /containers/<id>/stats endpoint — no Prometheus dependency for the
  // current-value numbers. Prometheus is still used for the sparkline
  // time series on the Service Detail page (see routes/metrics.ts).
  fastify.get('/services', async () => docker.listServices());

  fastify.get('/services/:id', async (req, reply) => {
    const parsed = IdParams.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const services = await docker.listServices();
    const found = services.find((s) => s.id === parsed.data.id);
    if (!found) return reply.code(404).send({ error: 'not_found' });
    return found;
  });

  fastify.post('/services/:id/restart', async (req, reply) => {
    const parsed = IdParams.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const services = await docker.listServices();
    const found = services.find((s) => s.id === parsed.data.id);
    if (!found || !found.container) return reply.code(404).send({ error: 'not_found' });
    await docker.restartContainer(found.container);
    return { ok: true };
  });
}
