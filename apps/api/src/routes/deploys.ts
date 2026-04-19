import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../lib/db.js';
import type { DeployEngine } from '../lib/deploys.js';
import { openSse } from '../lib/sse.js';

interface Deps {
  db: Db;
  engine: DeployEngine;
}

const LimitQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export async function deployRoutes(fastify: FastifyInstance, { db, engine }: Deps) {
  fastify.get('/deploys', async (req) => {
    const { limit } = LimitQuery.parse(req.query);
    return db.listDeploys(limit);
  });

  fastify.get('/deploys/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const deploy = db.getDeploy(id);
    if (!deploy) return reply.code(404).send({ error: 'not_found' });
    return deploy;
  });

  fastify.get('/deploys/:id/events', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const deploy = db.getDeploy(id);
    if (!deploy) return reply.code(404).send({ error: 'not_found' });

    const accept = String(req.headers['accept'] || '');
    if (!accept.includes('text/event-stream')) {
      return db.listDeployEvents(id);
    }

    const stream = openSse(req, reply);
    for (const ev of db.listDeployEvents(id)) stream.send('stage', ev);

    const unsub = engine.subscribe(id, (ev) => stream.send('stage', ev));
    stream.onClose(unsub);
  });

  fastify.post('/deploys/:id/rollback', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const deploy = db.getDeploy(id);
    if (!deploy) return reply.code(404).send({ error: 'not_found' });
    const prevSha = db.getPreviousSha(deploy.service, id);
    if (!prevSha) return reply.code(409).send({ error: 'no_previous_deploy' });
    const newDeploy = engine.enqueue({
      service: deploy.service,
      branch: deploy.branch,
      sha: prevSha,
      msg: `rollback to ${prevSha.slice(0, 7)}`,
      author: req.user || 'system',
    });
    return { id: newDeploy.id };
  });

  fastify.post('/deploys/:id/cancel', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const ok = engine.cancel(id);
    if (!ok) return reply.code(409).send({ error: 'not_running' });
    return { ok: true };
  });

  fastify.post('/services/:id/redeploy', async (req) => {
    const serviceId = (req.params as { id: string }).id;
    const body = z
      .object({ branch: z.string().default('main'), sha: z.string().optional() })
      .parse(req.body ?? {});
    const deploy = engine.enqueue({
      service: serviceId,
      branch: body.branch,
      sha: body.sha || 'HEAD',
      msg: 'manual redeploy',
      author: req.user || 'system',
    });
    return { id: deploy.id };
  });
}
