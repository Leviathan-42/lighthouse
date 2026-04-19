// Deploy engine — one concurrent deploy per service, the rest queue up.
// Pipeline runs checkout → build → test → deploy → healthcheck. Events stream
// live via the engine's pub/sub to any SSE subscribers on /deploys/:id/events.

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Deploy, DeployEvent, DeployPipelineStage } from '@lighthouse/shared';
import type { Db } from './db.js';
import type { DockerClient } from './docker.js';
import * as stages from './pipeline.js';
import type { StageResult } from './pipeline.js';
import type { FastifyBaseLogger } from 'fastify';

export interface DeployRequest {
  service: string;
  branch: string;
  sha: string;
  msg: string;
  author: string;
}

export interface DeployEngine {
  enqueue: (req: DeployRequest) => Deploy;
  cancel: (id: string) => boolean;
  subscribe: (deployId: string, fn: (ev: DeployEvent) => void) => () => void;
}

interface Deps {
  db: Db;
  docker: DockerClient;
  log: FastifyBaseLogger;
  deployRoot?: string;
}

const PIPELINE: DeployPipelineStage[] = ['checkout', 'build', 'test', 'deploy', 'healthcheck'];

export function createDeployEngine({ db, docker, log, deployRoot = '/tmp/deploys' }: Deps): DeployEngine {
  const subs = new Map<string, Set<(ev: DeployEvent) => void>>();
  const queues = new Map<string, Array<{ deploy: Deploy }>>();
  const running = new Map<string, string>(); // service → deployId
  const cancelled = new Set<string>();

  function emit(ev: DeployEvent) {
    db.appendDeployEvent(ev);
    const bucket = subs.get(ev.deployId);
    if (!bucket) return;
    for (const fn of bucket) {
      try { fn(ev); } catch { /* swallow */ }
    }
  }

  async function resolveRepoMeta(serviceId: string): Promise<{ repoUrl?: string; healthcheckUrl?: string }> {
    try {
      const svc = (await docker.listServices()).find((s) => s.id === serviceId);
      if (!svc?.container) return {};
      const info = await docker.raw.getContainer(svc.container).inspect();
      const labels = (info.Config?.Labels ?? {}) as Record<string, string>;
      return {
        repoUrl: labels['lighthouse.git_repo'],
        healthcheckUrl: labels['lighthouse.healthcheck'] ?? (svc.host ? `http://${svc.host}/healthz` : undefined),
      };
    } catch (err) {
      log.warn({ err, serviceId }, 'repo metadata lookup failed');
      return {};
    }
  }

  async function runPipeline(deploy: Deploy) {
    const started = Date.now();
    const meta = await resolveRepoMeta(deploy.service);
    if (!meta.repoUrl) {
      db.updateDeployStatus(deploy.id, 'failed', Date.now() - started, 'missing lighthouse.git_repo label');
      emit({ deployId: deploy.id, stage: 'checkout', status: 'error', ts: Date.now(), message: 'missing git_repo label' });
      return;
    }

    const ctx: stages.PipelineContext = {
      deployId: deploy.id,
      service: deploy.service,
      repoUrl: meta.repoUrl,
      sha: deploy.sha,
      workDir: join(deployRoot, deploy.id),
      ...(meta.healthcheckUrl ? { healthcheckUrl: meta.healthcheckUrl } : {}),
    };

    for (const stage of PIPELINE) {
      if (cancelled.has(deploy.id)) {
        emit({ deployId: deploy.id, stage, status: 'skipped', ts: Date.now(), message: 'cancelled' });
        db.updateDeployStatus(deploy.id, 'failed', Date.now() - started, 'cancelled');
        cancelled.delete(deploy.id);
        return;
      }
      emit({ deployId: deploy.id, stage, status: 'started', ts: Date.now() });
      const result = await runStage(stage, ctx);
      emit({
        deployId: deploy.id,
        stage,
        status: result.ok ? 'ok' : 'error',
        ts: Date.now(),
        durationMs: result.durationMs,
        ...(result.message ? { message: result.message } : {}),
      });
      if (!result.ok) {
        db.updateDeployStatus(deploy.id, 'failed', Date.now() - started, `${stage}: ${result.message || 'failed'}`);
        return;
      }
    }
    db.updateDeployStatus(deploy.id, 'success', Date.now() - started);
  }

  function runStage(stage: DeployPipelineStage, ctx: stages.PipelineContext): Promise<StageResult> {
    switch (stage) {
      case 'checkout': return stages.checkout(ctx);
      case 'build': return stages.build(ctx);
      case 'test': return stages.test(ctx);
      case 'deploy': return stages.deploy(ctx);
      case 'healthcheck': return stages.healthcheck(ctx);
    }
  }

  async function pump(service: string) {
    if (running.has(service)) return;
    const q = queues.get(service);
    if (!q || q.length === 0) return;
    const next = q.shift()!;
    running.set(service, next.deploy.id);
    try {
      await runPipeline(next.deploy);
    } catch (err) {
      log.error({ err, deployId: next.deploy.id }, 'pipeline crashed');
      db.updateDeployStatus(next.deploy.id, 'failed', undefined, (err as Error).message);
    } finally {
      running.delete(service);
      // Fire and forget the next item
      void pump(service);
    }
  }

  return {
    enqueue(req) {
      const id = `dep-${randomBytes(3).toString('hex')}`;
      const deploy: Deploy = {
        id,
        service: req.service,
        branch: req.branch,
        sha: req.sha,
        msg: req.msg,
        status: 'running',
        when: 'now',
        duration: '0s',
        author: req.author,
        diff: { added: 0, removed: 0, files: 0 },
      };
      db.createDeploy(deploy);
      const q = queues.get(req.service) ?? [];
      q.push({ deploy });
      queues.set(req.service, q);
      void pump(req.service);
      return deploy;
    },
    cancel(id) {
      const d = db.getDeploy(id);
      if (!d || d.status !== 'running') return false;
      cancelled.add(id);
      return true;
    },
    subscribe(deployId, fn) {
      let bucket = subs.get(deployId);
      if (!bucket) {
        bucket = new Set();
        subs.set(deployId, bucket);
      }
      bucket.add(fn);
      return () => {
        bucket?.delete(fn);
        if (bucket && bucket.size === 0) subs.delete(deployId);
      };
    },
  };
}
