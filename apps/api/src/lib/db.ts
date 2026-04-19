import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Deploy, DeployEvent, DeployPipelineStage } from '@lighthouse/shared';

export interface Db {
  listDeploys: (limit?: number) => Deploy[];
  getDeploy: (id: string) => Deploy | null;
  createDeploy: (d: Omit<Deploy, 'when'>) => void;
  updateDeployStatus: (id: string, status: Deploy['status'], durationMs?: number, error?: string) => void;
  listDeployEvents: (deployId: string) => DeployEvent[];
  appendDeployEvent: (e: DeployEvent) => void;
  getPreviousSha: (service: string, beforeId: string) => string | null;
  close: () => void;
  raw: DatabaseSync;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS deploys (
  id          TEXT PRIMARY KEY,
  service     TEXT NOT NULL,
  branch      TEXT NOT NULL,
  sha         TEXT NOT NULL,
  msg         TEXT,
  status      TEXT NOT NULL,
  author      TEXT,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  duration_ms INTEGER,
  error       TEXT,
  diff_added   INTEGER DEFAULT 0,
  diff_removed INTEGER DEFAULT 0,
  diff_files   INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_deploys_started   ON deploys (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_deploys_service   ON deploys (service, started_at DESC);

CREATE TABLE IF NOT EXISTS deploy_events (
  deploy_id   TEXT NOT NULL REFERENCES deploys(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  status      TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  duration_ms INTEGER,
  message     TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_deploy ON deploy_events (deploy_id, ts);
`;

export function openDb(dataDir: string): Db {
  const dbPath = join(dataDir, 'lighthouse.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const listStmt = db.prepare(`SELECT * FROM deploys ORDER BY started_at DESC LIMIT ?`);
  const getStmt = db.prepare(`SELECT * FROM deploys WHERE id = ?`);
  const insertStmt = db.prepare(`
    INSERT INTO deploys (id, service, branch, sha, msg, status, author, started_at, diff_added, diff_removed, diff_files)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStatusStmt = db.prepare(`
    UPDATE deploys SET status = ?, finished_at = ?, duration_ms = ?, error = ?
    WHERE id = ?
  `);
  const listEventsStmt = db.prepare(`SELECT * FROM deploy_events WHERE deploy_id = ? ORDER BY ts ASC`);
  const insertEventStmt = db.prepare(`
    INSERT INTO deploy_events (deploy_id, stage, status, ts, duration_ms, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const prevShaStmt = db.prepare(`
    SELECT sha FROM deploys
    WHERE service = ? AND id != ? AND status = 'success'
    ORDER BY started_at DESC LIMIT 1
  `);

  return {
    listDeploys(limit = 50) {
      const rows = listStmt.all(limit) as Array<Record<string, unknown>>;
      return rows.map(rowToDeploy);
    },
    getDeploy(id) {
      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      return row ? rowToDeploy(row) : null;
    },
    createDeploy(d) {
      insertStmt.run(
        d.id,
        d.service,
        d.branch,
        d.sha,
        d.msg,
        d.status,
        d.author,
        Date.now(),
        d.diff.added,
        d.diff.removed,
        d.diff.files,
      );
    },
    updateDeployStatus(id, status, durationMs, error) {
      updateStatusStmt.run(status, Date.now(), durationMs ?? null, error ?? null, id);
    },
    listDeployEvents(deployId) {
      const rows = listEventsStmt.all(deployId) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        deployId: r['deploy_id'] as string,
        stage: r['stage'] as DeployPipelineStage,
        status: r['status'] as DeployEvent['status'],
        ts: r['ts'] as number,
        durationMs: (r['duration_ms'] as number) ?? undefined,
        message: (r['message'] as string) ?? undefined,
      }));
    },
    appendDeployEvent(e) {
      insertEventStmt.run(e.deployId, e.stage, e.status, e.ts, e.durationMs ?? null, e.message ?? null);
    },
    getPreviousSha(service, beforeId) {
      const row = prevShaStmt.get(service, beforeId) as { sha?: string } | undefined;
      return row?.sha ?? null;
    },
    close() {
      db.close();
    },
    raw: db,
  };
}

function rowToDeploy(r: Record<string, unknown>): Deploy {
  const finished = r['finished_at'] as number | null;
  const started = r['started_at'] as number;
  const durationMs = (r['duration_ms'] as number | null) ?? (finished ? finished - started : null);
  return {
    id: r['id'] as string,
    service: r['service'] as string,
    branch: r['branch'] as string,
    sha: r['sha'] as string,
    msg: (r['msg'] as string) ?? '',
    status: r['status'] as Deploy['status'],
    when: formatRelative(started),
    duration: durationMs != null ? formatDuration(durationMs) : '—',
    author: (r['author'] as string) ?? 'unknown',
    diff: {
      added: (r['diff_added'] as number) ?? 0,
      removed: (r['diff_removed'] as number) ?? 0,
      files: (r['diff_files'] as number) ?? 0,
    },
    ...((r['error'] as string | null) ? { error: r['error'] as string } : {}),
  };
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
