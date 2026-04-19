import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Service } from '@lighthouse/shared';
import type { DockerClient } from '../lib/docker.js';
import type { PromClient } from '../lib/prometheus.js';

interface Deps {
  docker: DockerClient;
  prom: PromClient;
}

const IdParams = z.object({ id: z.string().min(1) });

export async function serviceRoutes(fastify: FastifyInstance, { docker, prom }: Deps) {
  fastify.get('/services', async (req) => {
    const [services, live] = await Promise.all([
      docker.listServices(),
      prom.instantByContainer().catch((err) => {
        req.log.debug({ err }, 'prometheus instant query failed — serving zeros');
        return null;
      }),
    ]);
    if (!live) return services;
    return services.map((svc) => enrich(svc, live));
  });

  fastify.get('/services/:id', async (req, reply) => {
    const parsed = IdParams.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const [services, live] = await Promise.all([
      docker.listServices(),
      prom.instantByContainer().catch(() => null),
    ]);
    const found = services.find((s) => s.id === parsed.data.id);
    if (!found) return reply.code(404).send({ error: 'not_found' });
    return live ? enrich(found, live) : found;
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

function enrich(svc: Service, live: NonNullable<Awaited<ReturnType<PromClient['instantByContainer']>>>): Service {
  return {
    ...svc,
    cpu: round(live.cpu.get(svc.id) ?? 0, 1),
    ram: Math.round(live.ram.get(svc.id) ?? 0),
    ramMax: Math.round(live.ramMax.get(svc.id) ?? svc.ramMax),
    netIn: round(live.netIn.get(svc.id) ?? 0, 2),
    netOut: round(live.netOut.get(svc.id) ?? 0, 2),
  };
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
