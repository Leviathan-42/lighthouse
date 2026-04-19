import { z } from 'zod';

// Env schema for the api. Fails fast at boot if required values are missing.
const envSchema = z.object({
  LIGHTHOUSE_PORT: z.coerce.number().int().positive().default(4000),
  LIGHTHOUSE_HOST: z.string().default('0.0.0.0'),
  LIGHTHOUSE_DATA_DIR: z.string().default('/data'),
  LIGHTHOUSE_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // `1` / `true` skips the Tailscale-User-Login auth check. Dev-only.
  LIGHTHOUSE_AUTH_BYPASS: z
    .string()
    .optional()
    .transform((v) => v === '1' || v?.toLowerCase() === 'true'),

  DOCKER_SOCK: z.string().default('/var/run/docker.sock'),

  PROMETHEUS_URL: z.string().url().default('http://prometheus:9090'),
  LOKI_URL: z.string().url().default('http://loki:3100'),

  TAILSCALE_CLIENT_ID: z.string().optional(),
  TAILSCALE_CLIENT_SECRET: z.string().optional(),
  TAILSCALE_TAILNET: z.string().optional(),

  GITEA_URL: z.string().url().optional(),
  GITEA_TOKEN: z.string().optional(),
  GITEA_WEBHOOK_SECRET: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${formatted}`);
  }
  return parsed.data;
}
