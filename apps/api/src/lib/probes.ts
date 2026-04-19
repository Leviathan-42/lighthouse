// Liveness probes for Prometheus, Loki, and Tailscale API — used by /readyz.

export async function probeUrl(url: string, timeoutMs = 2000): Promise<{ ok: boolean; detail?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok ? { ok: true } : { ok: false, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export function probePrometheus(baseUrl: string) {
  return probeUrl(`${baseUrl.replace(/\/$/, '')}/-/healthy`);
}

export function probeLoki(baseUrl: string) {
  return probeUrl(`${baseUrl.replace(/\/$/, '')}/ready`);
}

export async function probeTailscale(
  clientId: string | undefined,
  clientSecret: string | undefined,
): Promise<{ ok: boolean; detail?: string }> {
  if (!clientId || !clientSecret) return { ok: false, detail: 'TAILSCALE_CLIENT_ID/SECRET not set' };
  // We don't hit Tailscale's token endpoint on every readyz — just check env is present.
  // Real connectivity is verified on first /tailnet/* request.
  return { ok: true };
}
