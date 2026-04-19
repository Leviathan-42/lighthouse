// Local tailscaled socket client — gives us peer latency and link state,
// which the REST API doesn't expose.
//
// The socket lives at /var/run/tailscale/tailscaled.sock on the host. The api
// container mounts it read-only (see infra/compose.yml).

import { request } from 'node:http';

export interface LocalPeer {
  id: string;
  hostName: string;
  tailscaleIPs: string[];
  online: boolean;
  active: boolean;
  relay: string;
  curAddr: string;
  latencyMs: number | null;
  lastSeen: string | null;
}

export interface LocalStatus {
  selfId: string | null;
  peers: LocalPeer[];
}

const SOCKET = '/var/run/tailscale/tailscaled.sock';

export async function localTailscaleStatus(socketPath = SOCKET): Promise<LocalStatus | null> {
  return new Promise((resolve) => {
    const req = request(
      {
        socketPath,
        method: 'GET',
        path: '/localapi/v0/status',
        headers: { Host: 'local-tailscaled', Authorization: 'Basic ' + Buffer.from(':').toString('base64') },
        timeout: 1500,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) return resolve(null);
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RawStatus;
            resolve(projectStatus(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

interface RawStatus {
  Self?: RawPeer;
  Peer?: Record<string, RawPeer>;
}

interface RawPeer {
  ID: string;
  HostName?: string;
  TailscaleIPs?: string[];
  Online?: boolean;
  Active?: boolean;
  Relay?: string;
  CurAddr?: string;
  LastSeen?: string;
  // tailscaled exposes PingResults only on explicit ping; for passive latency
  // we fall back to the `rxBytes`/relay signal, but for now report null.
}

function projectStatus(raw: RawStatus): LocalStatus {
  const peers: LocalPeer[] = [];
  const push = (p: RawPeer) =>
    peers.push({
      id: p.ID,
      hostName: p.HostName ?? '',
      tailscaleIPs: p.TailscaleIPs ?? [],
      online: Boolean(p.Online),
      active: Boolean(p.Active),
      relay: p.Relay ?? '',
      curAddr: p.CurAddr ?? '',
      latencyMs: null,
      lastSeen: p.LastSeen ?? null,
    });
  if (raw.Self) push(raw.Self);
  for (const peer of Object.values(raw.Peer ?? {})) push(peer);
  return { selfId: raw.Self?.ID ?? null, peers };
}
