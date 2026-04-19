import type { FastifyInstance } from 'fastify';
import type { HealthSummary } from '@lighthouse/shared';
import type { DockerClient } from '../lib/docker.js';
import type { Config } from '../lib/config.js';
import { probePrometheus, probeLoki, probeTailscale } from '../lib/probes.js';

interface Deps {
  docker: DockerClient;
  config: Config;
}

export async function healthRoutes(fastify: FastifyInstance, { docker, config }: Deps) {
  fastify.get('/healthz', async () => ({ ok: true }));

  fastify.get('/readyz', async (_req, reply) => {
    const [dockerOk, prom, loki, tailscale] = await Promise.all([
      docker.ping(),
      probePrometheus(config.PROMETHEUS_URL),
      probeLoki(config.LOKI_URL),
      probeTailscale(config.TAILSCALE_CLIENT_ID, config.TAILSCALE_CLIENT_SECRET),
    ]);

    const summary: HealthSummary = {
      ok: dockerOk && prom.ok && loki.ok && tailscale.ok,
      checks: {
        docker: { ok: dockerOk, detail: dockerOk ? undefined : 'ping failed' },
        prometheus: prom,
        loki,
        tailscale,
      },
    };

    reply.code(summary.ok ? 200 : 503).send(summary);
  });
}
