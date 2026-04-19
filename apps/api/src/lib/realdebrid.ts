const RD_BASE = 'https://api.real-debrid.com/rest/1.0';

async function rdFetch(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${RD_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (res.status === 204 || res.status === 200 && init?.method === 'DELETE') return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Real-Debrid ${path} → ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export interface RdTorrent {
  id: string;
  filename: string;
  status: string;
  progress: number;
  bytes: number;
  seeders: number;
  added: string;
}

export function createRdClient(token: string) {
  return {
    listTorrents(): Promise<RdTorrent[]> {
      return rdFetch('/torrents?limit=100', token) as Promise<RdTorrent[]>;
    },

    async addMagnet(magnet: string): Promise<{ id: string; uri: string }> {
      const body = new URLSearchParams({ magnet });
      const data = await rdFetch('/torrents/addMagnet', token, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      // Auto-select all files so the torrent starts immediately
      await rdFetch(`/torrents/selectFiles/${data.id}`, token, {
        method: 'POST',
        body: new URLSearchParams({ files: 'all' }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      return data as { id: string; uri: string };
    },

    deleteTorrent(id: string): Promise<null> {
      return rdFetch(`/torrents/delete/${id}`, token, { method: 'DELETE' });
    },
  };
}

export type RdClient = ReturnType<typeof createRdClient>;
