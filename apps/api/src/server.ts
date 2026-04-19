import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import type { Config } from './lib/config.js';
import { createDockerClient } from './lib/docker.js';
import { createPromClient } from './lib/prometheus.js';
import { createLokiClient } from './lib/loki.js';
import { createTailscaleClient } from './lib/tailscale.js';
import { openDb } from './lib/db.js';
import { createDeployEngine } from './lib/deploys.js';
import { tailscaleAuth } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { serviceRoutes } from './routes/services.js';
import { metricsRoutes } from './routes/metrics.js';
import { logRoutes } from './routes/logs.js';
import { tailnetRoutes } from './routes/tailnet.js';
import { deployRoutes } from './routes/deploys.js';
import { webhookRoutes } from './routes/webhooks.js';

export async function buildServer(config: Config) {
  const fastify = Fastify({
    logger: {
      level: config.LIGHTHOUSE_LOG_LEVEL,
      transport:
        process.env.NODE_ENV === 'production'
          ? undefined
          : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
    },
  });

  await fastify.register(sensible);
  await fastify.register(cors, { origin: true, credentials: true });

  const docker = createDockerClient(config.DOCKER_SOCK);
  const prom = createPromClient(config.PROMETHEUS_URL);
  const loki = createLokiClient(config.LOKI_URL);
  const tailscale = createTailscaleClient({
    clientId: config.TAILSCALE_CLIENT_ID,
    clientSecret: config.TAILSCALE_CLIENT_SECRET,
    tailnet: config.TAILSCALE_TAILNET,
  });
  const db = openDb(config.LIGHTHOUSE_DATA_DIR);
  const engine = createDeployEngine({ db, docker, log: fastify.log });

  // Close DB on server shutdown
  fastify.addHook('onClose', async () => {
    db.close();
  });

  await fastify.register(tailscaleAuth, { bypass: config.LIGHTHOUSE_AUTH_BYPASS });

  await fastify.register(
    async (api) => {
      await healthRoutes(api, { docker, config });
      await serviceRoutes(api, { docker });
      await metricsRoutes(api, { docker, prom });
      await logRoutes(api, { docker, loki });
      await tailnetRoutes(api, { tailscale });
      await deployRoutes(api, { db, engine });
      await webhookRoutes(api, { docker, engine, webhookSecret: config.GITEA_WEBHOOK_SECRET });
    },
    { prefix: '/api/v1' },
  );

  // Root-level healthz/readyz so Traefik + systemd probes don't need the /api/v1 prefix
  await fastify.register(async (api) => {
    await healthRoutes(api, { docker, config });
  });

  return fastify;
}
