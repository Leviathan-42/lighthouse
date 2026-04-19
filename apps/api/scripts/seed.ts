// Seed the deploys table with a handful of fake rows so the Deploy feed
// isn't empty on a fresh install.
// Usage: pnpm --filter @lighthouse/api exec tsx --experimental-sqlite scripts/seed.ts

import { openDb } from '../src/lib/db.js';
import { loadConfig } from '../src/lib/config.js';

const config = loadConfig();
const db = openDb(config.LIGHTHOUSE_DATA_DIR);

const now = Date.now();
const SAMPLES = [
  { service: 'authentik', branch: 'main', sha: '3a9f12b', msg: 'feat(ml): upgrade clip model to ViT-L/14', status: 'success' as const, author: 'ezra', ageMin: 4, durationMs: 138_000, diff: { added: 142, removed: 38, files: 6 } },
  { service: 'dokploy', branch: 'main', sha: '8b4e772', msg: 'chore(deps): bump traefik to 3.2.1', status: 'success' as const, author: 'ezra', ageMin: 60, durationMs: 54_000, diff: { added: 4, removed: 4, files: 1 } },
  { service: 'paperless', branch: 'main', sha: 'c09e4d1', msg: 'feat: add tesseract lang pack for deu+fra', status: 'success' as const, author: 'ezra', ageMin: 180, durationMs: 102_000, diff: { added: 18, removed: 2, files: 3 } },
  { service: 'homeassistant', branch: 'main', sha: 'f71e2c9', msg: 'feat(automation): morning routine v3', status: 'failed' as const, author: 'ezra', ageMin: 360, durationMs: 38_000, diff: { added: 62, removed: 4, files: 4 }, error: 'automation.yaml:24 invalid trigger platform' },
  { service: 'grafana', branch: 'main', sha: '2d5a19f', msg: 'chore: pin plugin versions for reproducibility', status: 'success' as const, author: 'ezra', ageMin: 1440, durationMs: 28_000, diff: { added: 11, removed: 11, files: 1 } },
  { service: 'pocket-id', branch: 'main', sha: '5e1c248', msg: 'fix: webauthn challenge expiry increase', status: 'rolled-back' as const, author: 'ezra', ageMin: 2880, durationMs: 42_000, diff: { added: 2, removed: 2, files: 1 } },
];

db.raw.exec('DELETE FROM deploy_events; DELETE FROM deploys;');

for (let i = 0; i < SAMPLES.length; i++) {
  const s = SAMPLES[i]!;
  const id = `dep-${(i + 1).toString().padStart(4, '0')}`;
  const startedAt = now - s.ageMin * 60_000;
  db.raw
    .prepare(
      `INSERT INTO deploys (id, service, branch, sha, msg, status, author, started_at, finished_at, duration_ms, error, diff_added, diff_removed, diff_files)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      s.service,
      s.branch,
      s.sha,
      s.msg,
      s.status,
      s.author,
      startedAt,
      startedAt + s.durationMs,
      s.durationMs,
      (s as { error?: string }).error ?? null,
      s.diff.added,
      s.diff.removed,
      s.diff.files,
    );
}

// eslint-disable-next-line no-console
console.log(`seeded ${SAMPLES.length} deploys into ${config.LIGHTHOUSE_DATA_DIR}/lighthouse.db`);
db.close();
