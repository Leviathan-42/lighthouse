const TMDB_BASE = 'https://api.themoviedb.org/3';

async function tmdbGet(path: string, apiKey: string, params?: Record<string, string>) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', apiKey);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TMDb ${path} → ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

export function createTmdbClient(apiKey: string) {
  return {
    search: (query: string) =>
      tmdbGet('/search/multi', apiKey, { query, include_adult: 'false' }),

    trending: () => tmdbGet('/trending/all/day', apiKey, { include_adult: 'false' }),

    movie: (id: number) => tmdbGet(`/movie/${id}`, apiKey),
    tv: (id: number) => tmdbGet(`/tv/${id}`, apiKey),

    movieExternalIds: (id: number) => tmdbGet(`/movie/${id}/external_ids`, apiKey),
    tvExternalIds: (id: number) => tmdbGet(`/tv/${id}/external_ids`, apiKey),
    tvSeason: (id: number, season: number) => tmdbGet(`/tv/${id}/season/${season}`, apiKey),
  };
}

export type TmdbClient = ReturnType<typeof createTmdbClient>;
