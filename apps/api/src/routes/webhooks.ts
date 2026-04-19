import type { FastifyInstance } from 'fastify';
import type { DockerClient } from '../lib/docker.js';
import type { DeployEngine } from '../lib/deploys.js';
import { verifyGiteaSignature, refToBranch, type GiteaPushPayload } from '../lib/gitea.js';

interface Deps {
  docker: DockerClient;
  engine: DeployEngine;
  webhookSecret: string | undefined;
}

export async function webhookRoutes(fastify: FastifyInstance, { docker, engine, webhookSecret }: Deps) {
  // Capture raw body so we can verify HMAC. Must run before the JSON parser
  // materialises `request.body`.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, body.length > 0 ? JSON.parse(String(body)) : {});
      } catch (err) {
        done(err as Error);
      }
    },
  );

  fastify.post('/hooks/gitea', async (req, reply) => {
    if (!webhookSecret) return reply.code(503).send({ error: 'webhook_not_configured' });

    const signature = String(req.headers['x-gitea-signature'] ?? '');
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    if (!verifyGiteaSignature(rawBody, signature, webhookSecret)) {
      req.log.warn('gitea webhook: bad signature');
      return reply.code(401).send({ error: 'bad_signature' });
    }

    const event = String(req.headers['x-gitea-event'] ?? '');
    if (event !== 'push') return reply.code(204).send();

    const payload = req.body as GiteaPushPayload;
    const repoFull = payload.repository?.full_name;
    if (!repoFull) return reply.code(400).send({ error: 'no_repo' });

    const services = await docker.listServices();
    const match = await findServiceForRepo(docker, services, repoFull);
    if (!match) {
      req.log.info({ repoFull }, 'gitea webhook: no matching service');
      return reply.code(204).send();
    }

    const deploy = engine.enqueue({
      service: match,
      branch: refToBranch(payload.ref),
      sha: payload.after,
      msg: payload.head_commit?.message ?? 'push',
      author: payload.pusher?.login ?? payload.head_commit?.author?.username ?? 'gitea',
    });
    return { id: deploy.id };
  });
}

async function findServiceForRepo(docker: DockerClient, services: Awaited<ReturnType<DockerClient['listServices']>>, repoFull: string): Promise<string | null> {
  for (const svc of services) {
    if (!svc.container) continue;
    try {
      const info = await docker.raw.getContainer(svc.container).inspect();
      const labels = (info.Config?.Labels ?? {}) as Record<string, string>;
      const repo = labels['lighthouse.git_repo'];
      if (!repo) continue;
      if (repo === repoFull) return svc.id;
      if (repo.endsWith(`/${repoFull}`) || repo.includes(repoFull)) return svc.id;
    } catch {
      /* skip */
    }
  }
  return null;
}
