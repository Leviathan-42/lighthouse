import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface RdTorrent {
  id: string;
  filename: string;
  status: string;
  progress: number;
  bytes: number;
  seeders: number;
  added: string;
}

interface Toast {
  msg: string;
  type: 'success' | 'error';
}

function formatBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}

function statusColor(s: string) {
  if (s === 'downloaded') return 'var(--green)';
  if (['error', 'dead', 'magnet_error', 'virus'].includes(s)) return 'var(--red)';
  if (s === 'downloading') return 'var(--accent)';
  return 'var(--yellow)';
}

function statusLabel(s: string) {
  return s.replace(/_/g, ' ');
}

export function Library() {
  const [toast, setToast] = useState<Toast | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<RdTorrent[]>({
    queryKey: ['rd-library'],
    queryFn: () => api.get('/api/v1/media/library') as Promise<RdTorrent[]>,
    refetchInterval: 8000,
  });

  function showToast(msg: string, type: Toast['type']) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2200);
  }

  async function handleDelete(t: RdTorrent) {
    if (!confirm(`Remove "${t.filename}" from Real-Debrid?`)) return;
    setDeleting(t.id);
    try {
      await api.del(`/api/v1/media/torrents/${t.id}`);
      await refetch();
      showToast('Removed from library', 'success');
    } catch {
      showToast('Failed to remove', 'error');
    } finally {
      setDeleting(null);
    }
  }

  const torrents = data ?? [];

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">Library</h1>
        <button className="refresh-btn" onClick={() => void refetch()} aria-label="Refresh">↻</button>
      </div>

      <div className="library-scroll">
        {isLoading && <div className="loader">Loading library…</div>}

        {!isLoading && torrents.length === 0 && (
          <div className="empty">Your Real-Debrid library is empty</div>
        )}

        {torrents.map((t) => (
          <div key={t.id} className="torrent-item">
            <div className="torrent-info">
              <div className="torrent-name">{t.filename}</div>
              <div className="torrent-meta">
                <span style={{ color: statusColor(t.status) }}>
                  {statusLabel(t.status)}
                  {t.status === 'downloading' && ` ${t.progress}%`}
                </span>
                {t.bytes > 0 && (
                  <span> · {formatBytes(t.bytes)}</span>
                )}
              </div>
              {t.status === 'downloading' && (
                <div className="torrent-progress">
                  <div className="torrent-progress-fill" style={{ width: `${t.progress}%` }} />
                </div>
              )}
            </div>

            <button
              className="delete-btn"
              onClick={() => void handleDelete(t)}
              disabled={deleting === t.id}
              aria-label="Remove"
            >
              {deleting === t.id ? '…' : '✕'}
            </button>
          </div>
        ))}
      </div>

      {toast && (
        <div className={`toast ${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}
