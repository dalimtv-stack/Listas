const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require('./src/config');
require('dotenv').config();

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Manifest
const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.3.002',
  name: 'Heimdallr Channels',
  description: 'Addon para cargar canales Acestream o M3U8 desde una lista M3U.',
  types: ['tv'],
  logo: 'https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960',
  catalogs: [
    {
      type: 'tv',
      id: 'Heimdallr',
      name: 'Heimdallr Live Channels',
      // OJO: mantener "genre" aunque options esté vacío; el filtro funciona igualmente
      extra: [
        { name: 'search' },
        { name: 'genre', options: [], isRequired: false }
      ]
    }
  ],
  resources: ['stream', 'meta', 'catalog'],
  idPrefixes: [STREAM_PREFIX]
};

const builder = new addonBuilder(manifest);

// Helper: obtener géneros únicos desde group-title
async function computeGenres() {
  try {
    const channels = await getChannels();
    const genres = [...new Set(channels.map(c => c.group_title).filter(Boolean))];
    return genres.length ? genres : ['Otros'];
  } catch {
    return ['Otros'];
  }
}

// Catalog handler
builder.defineCatalogHandler(async (args = {}) => {
  const { type, id, extra = {} } = args;
  console.log('Catalog requested:', { type, id, extra });

  if (type !== 'tv' || id !== 'Heimdallr') return { metas: [] };

  // Cache solo para la vista sin filtros
  const useCache = !extra.genre && !extra.search;
  const cacheKey = 'Heimdallr_catalog';
  if (useCache) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  try {
    const channels = await getChannels();

    // Rellenar opciones de género (best-effort; no rompe si llega tarde)
    computeGenres().then(genres => {
      try {
        builder.manifest.catalogs[0].extra = [
          { name: 'search' },
          { name: 'genre', options: genres, isRequired: false }
        ];
      } catch (_) {}
    });

    let filtered = channels;

    // Filtrar por género (group-title)
    if (extra.genre) {
      filtered = filtered.filter(c => (c.group_title || '').toLowerCase() === extra.genre.toLowerCase());
    }

    // Filtrar por búsqueda
    if (extra.search) {
      const s = extra.search.toLowerCase();
      filtered = filtered.filter(c => (c.name || '').toLowerCase().includes(s));
    }

    const metas = filtered.map(channel => ({
      id: `${STREAM_PREFIX}${channel.id}`,
      type: 'tv',
      name: channel.name,
      poster: channel.logo_url || null,
      genre: channel.group_title ? [channel.group_title] : undefined
    }));

    const response = { metas };
    if (useCache) cache.set(cacheKey, response);
    return response;
  } catch (error) {
    console.error('Catalog error:', error);
    return { metas: [] };
  }
});

// Meta handler
builder.defineMetaHandler(async ({ type, id } = {}) => {
  console.log('Meta requested:', { type, id });

  if (type !== 'tv' || !id || !id.startsWith(STREAM_PREFIX)) return { meta: null };

  const channelId = id.replace(STREAM_PREFIX, '');
  const cacheKey = `meta_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channel = await getChannel(channelId);
    const response = {
      meta: {
        id,
        type: 'tv',
        name: channel.name,
        poster: channel.logo_url || null,
        background: channel.logo_url || null,
        description: channel.name || '',
        genre: channel.group_title ? [channel.group_title] : undefined
      }
    };
    cache.set(cacheKey, response);
    return response;
  } catch (error) {
    console.error('Meta error:', error);
    return { meta: null };
  }
});

// Stream handler
builder.defineStreamHandler(async ({ type, id } = {}) => {
  console.log('Stream requested:', { type, id });

  if (type !== 'tv' || !id || !id.startsWith(STREAM_PREFIX)) return { streams: [] };

  const channelId = id.replace(STREAM_PREFIX, '');
  const cacheKey = `stream_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('Using cached streams');
    return cached;
  }

  try {
    const channel = await getChannel(channelId);
    const streams = [];

    const list = Array.isArray(channel.additional_streams) ? channel.additional_streams : [];

    // Construir streams SOLO desde additional_streams (incluye el primero)
    for (const s of list) {
      const isAce = !!s.acestream_id;
      const httpUrl = s.url || s.stream_url || null;

      if (isAce) {
        // Acestream -> externo
        streams.push({
          name: s.group_title || channel.group_title || 'Acestream',
          title: s.title || channel.title || channel.name,
          externalUrl: `acestream://${s.acestream_id}`,
          behaviorHints: { notWebReady: true, external: true }
        });
      } else if (httpUrl) {
        // Cualquier HTTP/HTTPS -> interno (aunque no sea .m3u8)
        streams.push({
          name: s.group_title || channel.group_title || 'Stream',
          title: s.title || channel.title || channel.name,
          url: httpUrl
        });
      }
    }

    // Fallback por si no había additional_streams (muy raro con tu db.js)
    if (!streams.length) {
      if (channel.acestream_id) {
        streams.push({
          name: channel.group_title || 'Acestream',
          title: channel.title || channel.name,
          externalUrl: `acestream://${channel.acestream_id}`,
          behaviorHints: { notWebReady: true, external: true }
        });
      }
      if (channel.m3u8_url) {
        streams.push({
          name: channel.group_title || 'Stream',
          title: channel.title || channel.name,
          url: channel.m3u8_url
        });
      }
      if (channel.stream_url) {
        streams.push({
          name: channel.group_title || 'Stream',
          title: channel.title || channel.name,
          url: channel.stream_url
        });
      }
    }

    console.log('Streams generated:', streams);
    const response = { streams };
    cache.set(cacheKey, response);
    return response;
  } catch (error) {
    console.error('Stream error:', error);
    return { streams: [] };
  }
});

// Dev server
if (process.env.NODE_ENV !== 'production') {
  const { serveHTTP } = require('stremio-addon-sdk');
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

// Vercel handler
module.exports = (req, res) => {
  const addonInterface = builder.getInterface();
  const router = getRouter(addonInterface);
  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
