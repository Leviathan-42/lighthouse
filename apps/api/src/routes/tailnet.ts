import type { FastifyInstance } from 'fastify';
import type { TailscaleClient } from '../lib/tailscale.js';
import { openSse } from '../lib/sse.js';

interface Deps {
  tailscale: TailscaleClient;
}

export async function tailnetRoutes(fastify: FastifyInstance, { tailscale }: Deps) {
  fastify.get('/tailnet/devices', async (_req, reply) => {
    if (!tailscale.isConfigured()) return reply.code(503).send({ error: 'tailscale_not_configured' });
    try {
      return await tailscale.listDevices();
    } catch (err) {
      fastify.log.warn({ err }, 'tailnet devices failed');
      return reply.code(502).send({ error: 'tailscale_unreachable' });
    }
  });

  fastify.get('/tailnet/devices/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!tailscale.isConfigured()) return reply.code(503).send({ error: 'tailscale_not_configured' });
    const device = await tailscale.getDevice(id);
    if (!device) return reply.code(404).send({ error: 'not_found' });
    return device;
  });

  // Active-link stream. For now we emit the full device list at a slow interval —
  // local tailscaled socket polling (for peer latency + link state) is a step-5.5 extension.
  fastify.get('/tailnet/traffic', async (req, reply) => {
    if (!tailscale.isConfigured()) return reply.code(503).send({ error: 'tailscale_not_configured' });
    const stream = openSse(req, reply);
    const tick = async () => {
      try {
        const devices = await tailscale.listDevices();
        stream.send('snapshot', { devices, ts: Date.now() });
      } catch {
        /* swallow */
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    stream.onClose(() => clearInterval(timer));
  });
}
