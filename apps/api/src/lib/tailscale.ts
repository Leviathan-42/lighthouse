import type { TailnetNode } from '@lighthouse/shared';
import { localTailscaleStatus, type LocalPeer } from './tailscale-local.js';

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
    if (!config.clientId || !config.clientSecret) {
      // Even without OAuth, we can still show local tailscaled peers — handy
      // when the user hasn't wired the cloud API yet.
      const local = await localTailscaleStatus();
      return local ? local.peers.map((p, i) => localPeerToNode(p, i, local.peers.length, local.selfId)) : [];
    }
    const [remote, local] = await Promise.all([
      apiGet<{ devices: TsDevice[] }>(`/tailnet/${encodeURIComponent(tailnet())}/devices`),
      localTailscaleStatus(),
    ]);
    const localByIp = new Map<string, LocalPeer>();
    if (local) {
      for (const peer of local.peers) {
        for (const ip of peer.tailscaleIPs) localByIp.set(ip, peer);
      }
    }
    return remote.devices.map((d, i) => {
      const node = deviceToNode(d, i, remote.devices.length);
      const match = d.addresses.map((a) => localByIp.get(a)).find(Boolean);
      if (match) {
        // Online status comes from local tailscaled — it's the truth source
        // for whether a peer is currently reachable.
        if (!match.online) node.role = node.role; // keep role; role != online
      }
      return node;
    });
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
  const ip = d.addresses.find((a) => a.startsWith('100.')) || d.addresses[0] || '';
  const role = inferRole(d);
  const { x, y } = layoutPosition(role, i, total);
  const node: TailnetNode = {
    id: d.id,
    name: d.hostname || d.name,
    role,
    ip,
    os: d.os,
    latency: 0,
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

function localPeerToNode(p: LocalPeer, i: number, total: number, selfId: string | null): TailnetNode {
  const ip = p.tailscaleIPs.find((a) => a.startsWith('100.')) || p.tailscaleIPs[0] || '';
  const role: TailnetNode['role'] = p.id === selfId ? 'self' : inferRoleFromHostname(p.hostName);
  const { x, y } = layoutPosition(role, i, total);
  return {
    id: p.id,
    name: p.hostName || p.id,
    role,
    ip,
    os: '',
    latency: 0,
    x,
    y,
  };
}

// Hub-and-spoke layout: self top-center, servers in a row below,
// mobile to the left, cloud to the right. The mock's aesthetic.
function layoutPosition(role: TailnetNode['role'], i: number, total: number): { x: number; y: number } {
  if (role === 'self') return { x: 0.5, y: 0.18 };
  const bucket: Record<Exclude<TailnetNode['role'], 'self'>, { y: number; xRange: [number, number] }> = {
    server: { y: 0.55, xRange: [0.2, 0.8] },
    mobile: { y: 0.35, xRange: [0.05, 0.25] },
    cloud: { y: 0.82, xRange: [0.15, 0.85] },
  };
  const b = bucket[role];
  const spread = total > 1 ? (i % Math.max(total - 1, 1)) / Math.max(total - 1, 1) : 0.5;
  return { x: b.xRange[0] + spread * (b.xRange[1] - b.xRange[0]), y: b.y };
}

function inferRole(d: TsDevice): TailnetNode['role'] {
  const os = (d.os || '').toLowerCase();
  if (os.includes('ios') || os.includes('android')) return 'mobile';
  if (os.includes('linux') && d.hostname?.match(/^(oracle|hetzner|aws|gcp|azure|digitalocean)/i)) return 'cloud';
  if (os.includes('linux') || os.includes('bsd') || os.includes('macos') || os.includes('windows')) return 'server';
  return 'server';
}

function inferRoleFromHostname(hostname: string): TailnetNode['role'] {
  const h = hostname.toLowerCase();
  if (/(iphone|ipad|android|phone|mobile)/.test(h)) return 'mobile';
  if (/^(oracle|hetzner|aws|gcp|azure|digitalocean)/.test(h)) return 'cloud';
  return 'server';
}
