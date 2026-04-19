import type { FastifyInstance } from 'fastify';
import type { Config } from '../lib/config.js';
import { createRdClient } from '../lib/realdebrid.js';
import { createTmdbClient } from '../lib/tmdb.js';

const TORRENTIO = 'https://torrentio.strem.fun';

export async function mediaRoutes(fastify: FastifyInstance, { config }: { config: Config }) {
  const rd = config.RD_API_KEY ? createRdClient(config.RD_API_KEY) : null;
  const tmdb = config.TMDB_API_KEY ? createTmdbClient(config.TMDB_API_KEY) : null;

  // ── TMDb search ──────────────────────────────────────────────────────────
  fastify.get('/media/search', async (req, reply) => {
    if (!tmdb) return reply.badRequest('TMDB_API_KEY not configured');
    const { q } = req.query as { q?: string };
    if (!q?.trim()) return { results: [] };
    return tmdb.search(q.trim());
  });

  // ── TMDb detail + IMDB ID ─────────────────────────────────────────────────
  fastify.get<{ Params: { type: string; id: string } }>(
    '/media/tmdb/:type/:id',
    async (req, reply) => {
      if (!tmdb) return reply.badRequest('TMDB_API_KEY not configured');
      const { type, id } = req.params;
      if (type !== 'movie' && type !== 'tv') return reply.badRequest('type must be movie or tv');
      const numId = parseInt(id, 10);
      const [detail, ext] = await Promise.all([
        type === 'movie' ? tmdb.movie(numId) : tmdb.tv(numId),
        type === 'movie' ? tmdb.movieExternalIds(numId) : tmdb.tvExternalIds(numId),
      ]);
      return { ...detail, imdb_id: ext.imdb_id ?? null };
    },
  );

  // ── Torrentio — movie streams ─────────────────────────────────────────────
  fastify.get<{ Params: { imdbId: string } }>(
    '/media/streams/movie/:imdbId',
    async (req) => {
      const { imdbId } = req.params;
      const res = await fetch(`${TORRENTIO}/stream/movie/${imdbId}.json`);
      const data = (await res.json()) as { streams?: unknown[] };
      return { streams: data.streams ?? [] };
    },
  );

  // ── Torrentio — series streams ────────────────────────────────────────────
  fastify.get<{ Params: { imdbId: string; season: string; episode: string } }>(
    '/media/streams/series/:imdbId/:season/:episode',
    async (req) => {
      const { imdbId, season, episode } = req.params;
      const res = await fetch(
        `${TORRENTIO}/stream/series/${imdbId}:${season}:${episode}.json`,
      );
      const data = (await res.json()) as { streams?: unknown[] };
      return { streams: data.streams ?? [] };
    },
  );

  // ── RD library ────────────────────────────────────────────────────────────
  fastify.get('/media/library', async (_req, reply) => {
    if (!rd) return reply.badRequest('RD_API_KEY not configured');
    return rd.listTorrents();
  });

  // ── Add magnet to RD ──────────────────────────────────────────────────────
  fastify.post('/media/add', async (req, reply) => {
    if (!rd) return reply.badRequest('RD_API_KEY not configured');
    const { magnet } = req.body as { magnet?: string };
    if (!magnet?.startsWith('magnet:')) return reply.badRequest('invalid magnet');
    return rd.addMagnet(magnet);
  });

  // ── Delete from RD ────────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/media/torrents/:id', async (req, reply) => {
    if (!rd) return reply.badRequest('RD_API_KEY not configured');
    await rd.deleteTorrent(req.params.id);
    return reply.code(204).send();
  });
}
