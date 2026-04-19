import type { TailnetNode } from '@lighthouse/shared';

export interface TailscaleClient {
  listDevices: () => Promise<TailnetNode[]>;
  getDevice: (id: string) => Promise<TailnetNode | null>;
  isConfigured: () => boolean;
}

interface TailscaleConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  tailnet: string | undefined;
}

export function createTailscaleClient(config: TailscaleConfig): TailscaleClient {
  let token: { access_token: string; expires_at: number } | null = null;

  async function getToken(): Promise<string> {
    if (!config.clientId || !config.clientSecret) throw new Error('Tailscale not configured');
    if (token && token.expires_at > Date.now() + 30_000) return token.access_token;
    const res = await fetch('https://api.tailscale.com/api/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'client_credentials',
      }),
    });
    if (!res.ok) throw new Error(`tailscale oauth ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { access_token: body.access_token, expires_at: Date.now() + body.expires_in * 1000 };
    return token.access_token;
  }

  async function apiGet<T>(path: string): Promise<T> {
    const tk = await getToken();
    const res = await fetch(`https://api.tailscale.com/api/v2${path}`, {
      headers: { Authorization: `Bearer ${tk}` },
    });
    if (!res.ok) throw new Error(`tailscale api ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  function tailnet(): string {
    return config.tailnet || '-';
  }

  async function listDevices(): Promise<TailnetNode[]> {
    if (!config.clientId || !config.clientSecret) return [];
    const body = await apiGet<{ devices: TsDevice[] }>(`/tailnet/${encodeURIComponent(tailnet())}/devices`);
    return body.devices.map((d, i) => deviceToNode(d, i, body.devices.length));
  }

  async function getDevice(id: string): Promise<TailnetNode | null> {
    if (!config.clientId || !config.clientSecret) return null;
    try {
      const d = await apiGet<TsDevice>(`/device/${encodeURIComponent(id)}`);
      return deviceToNode(d, 0, 1);
    } catch {
      return null;
    }
  }

  return {
    listDevices,
    getDevice,
    isConfigured: () => Boolean(config.clientId && config.clientSecret),
  };
}

// Tailscale returns rich device objects; we project to TailnetNode for the UI.
interface TsDevice {
  id: string;
  name: string;
  hostname: string;
  os: string;
  addresses: string[];
  lastSeen: string;
  advertisedRoutes?: string[];
  enabledRoutes?: string[];
  isExternal?: boolean;
}

function deviceToNode(d: TsDevice, i: number, total: number): TailnetNode {
  // Lay nodes out on a circle for the map view. The UI only uses x/y for SVG
  // positioning; a smarter layout can come later.
  const angle = (i / Math.max(total, 1)) * Math.PI * 2;
  const x = 0.5 + 0.35 * Math.cos(angle);
  const y = 0.5 + 0.35 * Math.sin(angle);
  const ip = d.addresses.find((a) => a.startsWith('100.')) || d.addresses[0] || '';
  const node: TailnetNode = {
    id: d.id,
    name: d.hostname || d.name,
    role: inferRole(d),
    ip,
    os: d.os,
    latency: 0, // filled from local tailscaled on detail view
    x,
    y,
  };
  if (d.enabledRoutes && d.enabledRoutes.length > 0) {
    node.exitNode = d.enabledRoutes.includes('0.0.0.0/0') || d.enabledRoutes.includes('::/0');
    const subnet = d.enabledRoutes.find((r) => !r.startsWith('0.'));
    if (subnet) node.subnet = subnet;
  }
  return node;
}

function inferRole(d: TsDevice): TailnetNode['role'] {
  const os = (d.os || '').toLowerCase();
  if (os.includes('ios') || os.includes('android')) return 'mobile';
  if (os.includes('linux') && d.hostname?.match(/^(oracle|hetzner|aws|gcp|azure)/i)) return 'cloud';
  if (os.includes('linux') || os.includes('bsd') || os.includes('macos')) return 'server';
  return 'server';
}
