import { z } from 'zod';

// Preprocess helper — blank env vars behave as if unset, so the `.optional()`
// / `.default()` paths apply. `.env` files tend to leave keys like GITEA_URL=
// empty, which would otherwise fail z.string().url() validation.
const blankToUndef = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema);

const optionalString = blankToUndef(z.string().optional());
const optionalUrl = blankToUndef(z.string().url().optional());
const requiredUrlWithDefault = (defaultUrl: string) =>
  blankToUndef(z.string().url().default(defaultUrl));

const envSchema = z.object({
  LIGHTHOUSE_PORT: blankToUndef(z.coerce.number().int().positive().default(4000)),
  LIGHTHOUSE_HOST: blankToUndef(z.string().default('0.0.0.0')),
  LIGHTHOUSE_DATA_DIR: blankToUndef(z.string().default('/data')),
  LIGHTHOUSE_LOG_LEVEL: blankToUndef(
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ),

  // `1` / `true` skips the Tailscale-User-Login auth check. Dev-only.
  LIGHTHOUSE_AUTH_BYPASS: optionalString.transform(
    (v) => v === '1' || v?.toLowerCase() === 'true',
  ),

  DOCKER_SOCK: blankToUndef(z.string().default('/var/run/docker.sock')),

  PROMETHEUS_URL: requiredUrlWithDefault('http://prometheus:9090'),
  LOKI_URL: requiredUrlWithDefault('http://loki:3100'),

  TAILSCALE_CLIENT_ID: optionalString,
  TAILSCALE_CLIENT_SECRET: optionalString,
  TAILSCALE_TAILNET: optionalString,

  GITEA_URL: optionalUrl,
  GITEA_TOKEN: optionalString,
  GITEA_WEBHOOK_SECRET: optionalString,
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
