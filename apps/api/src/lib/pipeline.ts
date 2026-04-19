// Pipeline stages — thin wrappers around git + docker compose invocations.
// Each stage resolves to a { ok, durationMs, message } record that the engine logs.

import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { DeployPipelineStage } from '@lighthouse/shared';

export interface StageResult {
  stage: DeployPipelineStage;
  ok: boolean;
  durationMs: number;
  message?: string;
}

export interface PipelineContext {
  deployId: string;
  service: string;
  repoUrl: string; // e.g. https://gitea.local/ezra/authentik.git
  sha: string;
  workDir: string; // /tmp/deploys/<deployId>
  healthcheckUrl?: string;
}

const STAGE_TIMEOUT_MS = 10 * 60 * 1000;

function runProcess(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd, timeout: STAGE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) });
    });
    // Prevent unhandled rejections if the process is detached later.
    child.on('error', () => { /* handled via callback */ });
  });
}

async function withTiming<T>(stage: DeployPipelineStage, fn: () => Promise<{ ok: boolean; message?: string }>): Promise<StageResult> {
  const started = Date.now();
  try {
    const res = await fn();
    return { stage, ok: res.ok, durationMs: Date.now() - started, message: res.message };
  } catch (err) {
    return { stage, ok: false, durationMs: Date.now() - started, message: (err as Error).message };
  }
}

export function checkout(ctx: PipelineContext): Promise<StageResult> {
  return withTiming('checkout', async () => {
    await rm(ctx.workDir, { recursive: true, force: true });
    await mkdir(ctx.workDir, { recursive: true });
    const clone = await runProcess('git', ['clone', '--depth', '50', ctx.repoUrl, ctx.workDir], '/');
    if (!clone.ok) return { ok: false, message: clone.stderr.slice(0, 500) };
    const checkout = await runProcess('git', ['checkout', ctx.sha], ctx.workDir);
    if (!checkout.ok) return { ok: false, message: checkout.stderr.slice(0, 500) };
    return { ok: true };
  });
}

export function build(ctx: PipelineContext): Promise<StageResult> {
  return withTiming('build', async () => {
    const res = await runProcess('docker', ['compose', 'build'], ctx.workDir);
    return res.ok
      ? { ok: true }
      : { ok: false, message: res.stderr.slice(0, 500) };
  });
}

export function test(ctx: PipelineContext): Promise<StageResult> {
  return withTiming('test', async () => {
    // Optional — skip if no Makefile target.
    if (!existsSync(join(ctx.workDir, 'Makefile'))) {
      return { ok: true, message: 'no Makefile — skipped' };
    }
    // Probe for a `test` target
    const probe = await runProcess('make', ['-n', 'test'], ctx.workDir);
    if (!probe.ok) return { ok: true, message: 'no `test` target — skipped' };
    const res = await runProcess('make', ['test'], ctx.workDir);
    return res.ok
      ? { ok: true }
      : { ok: false, message: res.stderr.slice(0, 500) };
  });
}

export function deploy(ctx: PipelineContext): Promise<StageResult> {
  return withTiming('deploy', async () => {
    const res = await runProcess('docker', ['compose', 'up', '-d'], ctx.workDir);
    return res.ok
      ? { ok: true }
      : { ok: false, message: res.stderr.slice(0, 500) };
  });
}

export function healthcheck(ctx: PipelineContext): Promise<StageResult> {
  return withTiming('healthcheck', async () => {
    if (!ctx.healthcheckUrl) return { ok: true, message: 'no healthcheck URL — assumed ok' };
    const deadline = Date.now() + 30_000;
    let consecutive = 0;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(ctx.healthcheckUrl, { signal: AbortSignal.timeout(2_000) });
        if (res.ok) {
          consecutive += 1;
          if (consecutive >= 3) return { ok: true, message: `${ctx.healthcheckUrl} → 200 ×3` };
        } else {
          consecutive = 0;
        }
      } catch {
        consecutive = 0;
      }
      await sleep(1_500);
    }
    return { ok: false, message: `healthcheck failed within 30s` };
  });
}

// Used by rollback — checks out the previous SHA and re-runs deploy+healthcheck only.
export async function rollbackTo(ctx: PipelineContext): Promise<StageResult[]> {
  const out: StageResult[] = [];
  const co = await checkout(ctx);
  out.push(co);
  if (!co.ok) return out;
  const dep = await deploy(ctx);
  out.push(dep);
  if (!dep.ok) return out;
  const hc = await healthcheck(ctx);
  out.push(hc);
  return out;
}
