import type { TailnetNode } from '@lighthouse/shared';
import { localPing, localTailscaleStatus, type LocalPeer } from './tailscale-local.js';

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
      const local = await localTailscaleStatus();
      if (!local) return [];
      const nodes = local.peers.map((p) => localPeerToNode(p, local.selfId));
      await fillLatencies(nodes);
      return assignRadialLayout(nodes);
    }
    const [remote, local] = await Promise.all([
      apiGet<{ devices: TsDevice[] }>(`/tailnet/${encodeURIComponent(tailnet())}/devices`),
      localTailscaleStatus(),
    ]);
    const localByIp = new Map<string, LocalPeer>();
    const selfIps = new Set<string>();
    if (local) {
      for (const peer of local.peers) {
        for (const ip of peer.tailscaleIPs) localByIp.set(ip, peer);
        if (peer.id === local.selfId) for (const ip of peer.tailscaleIPs) selfIps.add(ip);
      }
    }
    const nodes = remote.devices.map((d) => {
      const node = deviceToNode(d);
      // Mark the device matching our own tailscaled as `self` so the map can
      // pin it at the center. Match by IP — device IDs are formatted differently
      // across the OAuth API vs local tailscaled.
      if (d.addresses.some((a) => selfIps.has(a))) node.role = 'self';
      const match = d.addresses.map((a) => localByIp.get(a)).find(Boolean);
      if (match && !match.online) node.latency = -1;
      return node;
    });
    await fillLatencies(nodes);
    return assignRadialLayout(nodes);
  }

  async function fillLatencies(nodes: TailnetNode[]): Promise<void> {
    // Ping every non-self peer in parallel. Short timeout so a single slow peer
    // can't hold up the whole response; unresponsive peers just stay at 0.
    await Promise.all(
      nodes.map(async (n) => {
        if (n.role === 'self' || !n.ip || n.latency === -1) return;
        const ms = await localPing(n.ip, undefined, 1200);
        if (ms != null) n.latency = ms;
      }),
    );
  }

  async function getDevice(id: string): Promise<TailnetNode | null> {
    if (!config.clientId || !config.clientSecret) return null;
    try {
      const d = await apiGet<TsDevice>(`/device/${encodeURIComponent(id)}`);
      return deviceToNode(d);
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

function deviceToNode(d: TsDevice): TailnetNode {
  const ip = d.addresses.find((a) => a.startsWith('100.')) || d.addresses[0] || '';
  const role = inferRole(d);
  const node: TailnetNode = {
    id: d.id,
    name: d.hostname || d.name,
    role,
    ip,
    os: d.os,
    latency: 0,
    x: 0.5,
    y: 0.5,
  };
  if (d.enabledRoutes && d.enabledRoutes.length > 0) {
    node.exitNode = d.enabledRoutes.includes('0.0.0.0/0') || d.enabledRoutes.includes('::/0');
    const subnet = d.enabledRoutes.find((r) => !r.startsWith('0.'));
    if (subnet) node.subnet = subnet;
  }
  return node;
}

function localPeerToNode(p: LocalPeer, selfId: string | null): TailnetNode {
  const ip = p.tailscaleIPs.find((a) => a.startsWith('100.')) || p.tailscaleIPs[0] || '';
  const role: TailnetNode['role'] = p.id === selfId ? 'self' : inferRoleFromHostname(p.hostName);
  return {
    id: p.id,
    name: p.hostName || p.id,
    role,
    ip,
    os: '',
    latency: 0,
    x: 0.5,
    y: 0.5,
  };
}

// Radial layout — self at the center, peers spread on a ring around it.
// Mobile sits on a tighter inner ring, cloud nodes on a wider outer one,
// servers in between. Gives the map the "hub + spokes" look from the mock.
function assignRadialLayout(nodes: TailnetNode[]): TailnetNode[] {
  const self = nodes.find((n) => n.role === 'self');
  const peers = nodes.filter((n) => n !== self);
  const result: TailnetNode[] = [];
  if (self) result.push({ ...self, x: 0.5, y: 0.5 });

  // Seeded angular offset per node so the ring orientation is stable across refreshes.
  peers.forEach((peer, i) => {
    const base = (i / Math.max(peers.length, 1)) * Math.PI * 2;
    // Gentle wobble per node keeps it from feeling like a dial
    const wobble = (hashStr(peer.id) % 100) / 800; // ±0.125 rad
    const angle = base - Math.PI / 2 + wobble;
    const radius =
      peer.role === 'cloud' ? 0.42 :
      peer.role === 'mobile' ? 0.24 :
      0.32;
    result.push({
      ...peer,
      x: 0.5 + radius * Math.cos(angle),
      y: 0.5 + radius * Math.sin(angle),
    });
  });
  return result;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
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
