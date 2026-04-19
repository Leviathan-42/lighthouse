// Local tailscaled socket client — gives us peer latency and link state,
// which the REST API doesn't expose.
//
// The socket lives at /var/run/tailscale/tailscaled.sock on the host. The api
// container mounts it read-only (see infra/compose.yml).

import { request } from 'node:http';

const AUTH_HEADER = 'Basic ' + Buffer.from(':').toString('base64');

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
  const body = await localApiGet<RawStatus>('/localapi/v0/status', socketPath, 1500);
  return body ? projectStatus(body) : null;
}

// Active disco ping via tailscaled's LocalAPI. Returns RTT in ms, or null on
// timeout/failure. Used to populate the latency field on TailnetNode.
export async function localPing(ip: string, socketPath = SOCKET, timeoutMs = 1500): Promise<number | null> {
  return new Promise((resolve) => {
    const req = request(
      {
        socketPath,
        method: 'POST',
        path: `/localapi/v0/ping?ip=${encodeURIComponent(ip)}&type=disco`,
        // `Sec-Tailscale: localapi` is required by tailscaled's CSRF guard on
        // "unsafe" (state-modifying) endpoints like ping. Status skips this.
        headers: {
          Host: 'local-tailscaled.sock',
          Authorization: AUTH_HEADER,
          'Sec-Tailscale': 'localapi',
          'Content-Length': '0',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) return resolve(null);
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              LatencySeconds?: number;
              Err?: string;
            };
            if (body.Err || typeof body.LatencySeconds !== 'number') return resolve(null);
            resolve(Math.round(body.LatencySeconds * 1000));
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

function localApiGet<T>(path: string, socketPath: string, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const req = request(
      {
        socketPath,
        method: 'GET',
        path,
        headers: { Host: 'local-tailscaled.sock', Authorization: AUTH_HEADER },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) return resolve(null);
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
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
