import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

// Open routes that don't require a Tailscale-User-Login header.
// Traefik / systemd healthchecks must hit these without the header.
const OPEN_PATHS = new Set(['/healthz', '/readyz']);

export const tailscaleAuth: FastifyPluginAsync<{ bypass: boolean }> = async (
  fastify: FastifyInstance,
  opts,
) => {
  fastify.addHook('onRequest', async (req, reply) => {
    if (OPEN_PATHS.has(req.url.split('?')[0]!)) return;
    if ((req.routeOptions?.config as { skipAuth?: boolean } | undefined)?.skipAuth) return;

    const login = req.headers['tailscale-user-login'];
    if (opts.bypass) {
      (req as unknown as { user: string }).user = typeof login === 'string' ? login : 'dev@local';
      return;
    }

    if (typeof login !== 'string' || login.length === 0) {
      reply.code(403).send({ error: 'forbidden', message: 'Tailscale-User-Login header required' });
      return;
    }

    (req as unknown as { user: string }).user = login;
  });
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: string;
  }
}
