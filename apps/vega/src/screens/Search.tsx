import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

const TMDB_IMG = 'https://image.tmdb.org/t/p';

interface SearchResult {
  id: number;
  media_type: 'movie' | 'tv';
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
}

interface TmdbDetail extends SearchResult {
  imdb_id?: string | null;
  number_of_seasons?: number;
  runtime?: number;
  genres?: { id: number; name: string }[];
}

interface TorrentioStream {
  name?: string;
  title?: string;
  infoHash?: string;
  url?: string;
  fileIdx?: number;
}

interface Toast {
  msg: string;
  type: 'success' | 'error';
}

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function mediaTitle(r: SearchResult | TmdbDetail) {
  return r.title ?? r.name ?? '';
}

function mediaYear(r: SearchResult | TmdbDetail) {
  return (r.release_date ?? r.first_air_date ?? '').slice(0, 4);
}

export function Search() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 400);

  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [detail, setDetail] = useState<TmdbDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [episodeCount, setEpisodeCount] = useState(0);
  const [episodeLoading, setEpisodeLoading] = useState(false);
  const [streams, setStreams] = useState<TorrentioStream[] | null>(null);
  const [streamsLoading, setStreamsLoading] = useState(false);

  const [adding, setAdding] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const { data: trendingData } = useQuery({
    queryKey: ['tmdb-trending'],
    queryFn: () => api.get('/api/v1/media/trending') as Promise<{ results?: (SearchResult & { media_type: string })[] }>,
    enabled: debouncedQuery.length < 2,
    staleTime: 5 * 60_000,
  });

  const { data: searchData, isLoading: searching } = useQuery({
    queryKey: ['tmdb-search', debouncedQuery],
    queryFn: () =>
      api.get(`/api/v1/media/search?q=${encodeURIComponent(debouncedQuery)}`) as Promise<{
        results?: (SearchResult & { media_type: string })[];
      }>,
    enabled: debouncedQuery.length >= 2,
  });

  const isShowingTrending = debouncedQuery.length < 2;

  const results: SearchResult[] = isShowingTrending
    ? (trendingData?.results?.filter((r): r is SearchResult => r.media_type === 'movie' || r.media_type === 'tv') ?? [])
    : (searchData?.results?.filter((r): r is SearchResult => r.media_type === 'movie' || r.media_type === 'tv') ?? []);

  function showToast(msg: string, type: Toast['type']) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2200);
  }

  async function loadEpisodeCount(tmdbId: number, s: number) {
    setEpisodeLoading(true);
    setEpisodeCount(0);
    setEpisode(1);
    try {
      const data = await api.get(`/api/v1/media/tmdb/tv/${tmdbId}/season/${s}`) as { episode_count: number };
      setEpisodeCount(data.episode_count);
    } finally {
      setEpisodeLoading(false);
    }
  }

  async function openDetail(item: SearchResult) {
    setSelected(item);
    setDetail(null);
    setStreams(null);
    setSeason(1);
    setEpisode(1);
    setEpisodeCount(0);
    setDetailLoading(true);
    try {
      const data = await api.get(`/api/v1/media/tmdb/${item.media_type}/${item.id}`);
      const d = { ...(data as TmdbDetail), media_type: item.media_type };
      setDetail(d);
      if (item.media_type === 'tv') loadEpisodeCount(item.id, 1);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelected(null);
    setDetail(null);
    setStreams(null);
    setEpisodeCount(0);
  }

  async function fetchStreams() {
    if (!detail?.imdb_id) {
      showToast('No IMDB ID found for this title', 'error');
      return;
    }
    setStreamsLoading(true);
    setStreams(null);
    try {
      const path =
        detail.media_type === 'movie'
          ? `/api/v1/media/streams/movie/${detail.imdb_id}`
          : `/api/v1/media/streams/series/${detail.imdb_id}/${season}/${episode}`;
      const data = (await api.get(path)) as { streams: TorrentioStream[] };
      setStreams(data.streams ?? []);
    } catch {
      showToast('Failed to fetch streams', 'error');
    } finally {
      setStreamsLoading(false);
    }
  }

  async function addStream(stream: TorrentioStream) {
    if (!stream.infoHash) return;
    const magnet = `magnet:?xt=urn:btih:${stream.infoHash}`;
    const key = stream.infoHash;
    setAdding(key);
    try {
      await api.post('/api/v1/media/add', { magnet });
      showToast('Added to Real-Debrid!', 'success');
      closeDetail();
    } catch {
      showToast('Failed to add to RD', 'error');
    } finally {
      setAdding(null);
    }
  }

  const displayTitle = detail ? mediaTitle(detail) : selected ? mediaTitle(selected) : '';
  const displayYear = detail ? mediaYear(detail) : selected ? mediaYear(selected) : '';
  const posterUrl = selected?.poster_path ? `${TMDB_IMG}/w342${selected.poster_path}` : null;
  const backdropUrl = (detail ?? selected)?.backdrop_path
    ? `${TMDB_IMG}/w780${(detail ?? selected)!.backdrop_path}`
    : null;

  return (
    <div className="screen">
      <div className="search-wrap">
        <div className="search-bar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="search"
            placeholder="Movies, shows…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {query && (
            <button className="clear-btn" onClick={() => setQuery('')}>
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="results-scroll">
        {searching && <div className="loader">Searching…</div>}

        {!searching && results.length > 0 && (
          <>
            {isShowingTrending && (
              <div className="results-heading">Trending now</div>
            )}
          <div className="results-grid">
            {results.map((r) => (
              <button key={`${r.media_type}-${r.id}`} className="poster-card" onClick={() => void openDetail(r)}>
                {r.poster_path ? (
                  <img
                    src={`${TMDB_IMG}/w342${r.poster_path}`}
                    alt={mediaTitle(r)}
                    className="poster-card-img"
                    loading="lazy"
                  />
                ) : (
                  <div className="poster-card-no-img">{mediaTitle(r)}</div>
                )}
                <div className="poster-card-info">
                  <div className="poster-card-title">{mediaTitle(r)}</div>
                  <div className="poster-card-meta">
                    {mediaYear(r)}
                    {mediaYear(r) && ' · '}
                    {r.media_type === 'movie' ? 'Movie' : 'Show'}
                  </div>
                </div>
              </button>
            ))}
          </div>
          </>
        )}

        {!searching && debouncedQuery.length >= 2 && results.length === 0 && (
          <div className="empty">No results for "{debouncedQuery}"</div>
        )}
      </div>

      {/* ── Detail sheet ──────────────────────────────────────────── */}
      {selected && (
        <div className="sheet-overlay" onClick={closeDetail}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />

            {backdropUrl ? (
              <div
                className="sheet-backdrop"
                style={{ backgroundImage: `url(${backdropUrl})` }}
              >
                <button className="sheet-close" onClick={closeDetail}>✕</button>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 16px' }}>
                <button className="sheet-close-inline" onClick={closeDetail}>✕</button>
              </div>
            )}

            <div className="sheet-body">
              <div className="sheet-header">
                {posterUrl ? (
                  <img src={posterUrl} alt={displayTitle} className="sheet-poster" />
                ) : (
                  <div className="sheet-no-poster" />
                )}
                <div className="sheet-meta">
                  <h2 className="sheet-title">{displayTitle}</h2>
                  <div className="sheet-tags">
                    {displayYear && <span className="tag">{displayYear}</span>}
                    <span className="tag">
                      {selected.media_type === 'movie' ? 'Movie' : 'TV Show'}
                    </span>
                    {detail?.vote_average && detail.vote_average > 0 && (
                      <span className="tag accent">★ {detail.vote_average.toFixed(1)}</span>
                    )}
                  </div>
                  {detail?.genres && (
                    <div className="sheet-genres">
                      {detail.genres.slice(0, 3).map((g) => (
                        <span key={g.id} className="genre-chip">
                          {g.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {detailLoading && <div className="loader">Loading…</div>}

              {detail && (
                <>
                  {detail.overview && (
                    <p className="sheet-overview">{detail.overview}</p>
                  )}

                  {/* Season picker for TV shows */}
                  {detail.media_type === 'tv' && (detail.number_of_seasons ?? 0) > 0 && (
                    <div className="season-picker">
                      <span className="season-label">Season</span>
                      <div className="season-nums">
                        {Array.from(
                          { length: detail.number_of_seasons! },
                          (_, i) => i + 1,
                        ).map((s) => (
                          <button
                            key={s}
                            className={`season-btn${season === s ? ' active' : ''}`}
                            onClick={() => {
                              setSeason(s);
                              setStreams(null);
                              loadEpisodeCount(selected!.id, s);
                            }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Episode picker */}
                  {detail.media_type === 'tv' && (
                    <div className="season-picker">
                      <span className="season-label">
                        Episode{episodeLoading ? ' — loading…' : ''}
                      </span>
                      {!episodeLoading && episodeCount > 0 && (
                        <div className="season-nums">
                          {Array.from({ length: episodeCount }, (_, i) => i + 1).map((e) => (
                            <button
                              key={e}
                              className={`season-btn${episode === e ? ' active' : ''}`}
                              onClick={() => { setEpisode(e); setStreams(null); }}
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {!streams && !streamsLoading && (
                    <button className="primary-btn" onClick={() => void fetchStreams()}>
                      {detail.media_type === 'tv'
                        ? `Find streams — S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}`
                        : 'Find streams'}
                    </button>
                  )}

                  {streamsLoading && <div className="loader">Finding streams…</div>}

                  {streams && streams.length === 0 && (
                    <div className="empty" style={{ padding: '20px 0' }}>
                      No streams found
                    </div>
                  )}

                  {streams && streams.length > 0 && (
                    <>
                      <div className="stream-heading">Pick a stream</div>
                      <div className="stream-list">
                        {streams.slice(0, 15).map((s, i) => (
                          <button
                            key={i}
                            className="stream-item"
                            onClick={() => void addStream(s)}
                            disabled={adding !== null}
                          >
                            {s.name && (
                              <div className="stream-name">{s.name}</div>
                            )}
                            {s.title && (
                              <div className="stream-desc">
                                {s.title.split('\n').slice(-2).join(' · ')}
                              </div>
                            )}
                            {adding === s.infoHash && (
                              <span className="stream-adding">Adding to RD…</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
