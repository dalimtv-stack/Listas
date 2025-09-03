const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require('./src/config');
require('dotenv').config();

const cache = new NodeCache({ stdTTL: CACHE_TTL });

async function getGenres() {
  const channels = await getChannels();
  const genres = [...new Set(channels.map(c => c.group_title).filter(Boolean))];
  return genres;
}

const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.3.0',
  name: 'Heimdallr Channels',
  description: 'Addon para cargar canales Acestream o M3U8 desde una lista M3U.',
  types: ['tv'],
  logo: "https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960",
  catalogs: [
    {
      type: 'tv',
      id: 'Heimdallr',
      name: 'Heimdallr Live Channels',
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

// Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  console.log('Catalog requested:', type, id, extra);

  if (type === 'tv' && id === 'Heimdallr') {
    const cacheKey = 'Heimdallr_channels';
    const cached = cache.get(cacheKey);

    if (cached && !extra.genre && !extra.search) {
      console.log("Using cached catalog");
      return cached;
    }

    try {
      const channels = await getChannels();
      const genres = await getGenres();

      // actualizar opciones de géneros dinámicamente
      builder.manifest.catalogs[0].extra.find(e => e.name === 'genre').options = genres;

      let filtered = channels;

      // Filtro por género
      if (extra.genre) {
        filtered = filtered.filter(c => c.group_title === extra.genre);
      }

      // Filtro por búsqueda
      if (extra.search) {
        const searchTerm = extra.search.toLowerCase();
        filtered = filtered.filter(c => c.name.toLowerCase().includes(searchTerm));
      }

      const metas = filtered.map(channel => ({
        id: `${STREAM_PREFIX}${channel.id}`,
        type: 'tv',
        name: channel.name,
        poster: channel.logo_url,
        genre: [channel.group_title] // añadir género visible en ficha
      }));

      const response = { metas };
      if (!extra.genre && !extra.search) cache.set(cacheKey, response);
      return response;
    } catch (error) {
      console.error('Catalog error:', error);
      return { metas: [] };
    }
  }
  return { metas: [] };
});

// Meta handler
builder.defineMetaHandler(async ({ type, id }) => {
  console.log('Meta requested:', type, id);

  if (type === 'tv' && id.startsWith(STREAM_PREFIX)) {
    const channelId = id.replace(STREAM_PREFIX, '');
    const cacheKey = `meta_${channelId}`;
    const cached = cache.get(cacheKey);

    if (cached) return cached;

    try {
      const channel = await getChannel(channelId);
      const response = {
        meta: {
          id: id,
          type: 'tv',
          name: channel.name,
          poster: channel.logo_url,
          background: channel.logo_url,
          description: channel.name,
          genre: [channel.group_title]
        }
      };
      cache.set(cacheKey, response);
      return response;
    } catch (error) {
      console.error('Meta error:', error);
      return { meta: null };
    }
  }
  return { meta: null };
});

// Stream handler
builder.defineStreamHandler(async ({ type, id }) => {
  console.log('Stream requested:', type, id);

  if (type === 'tv' && id.startsWith(STREAM_PREFIX)) {
    const channelId = id.replace(STREAM_PREFIX, '');
    const cacheKey = `stream_${channelId}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      console.log("Using cached streams");
      return cached;
    }

    try {
      const channel = await getChannel(channelId);
      const streams = [];

      if (channel.acestream_id) {
        // Acestream -> externo
        streams.push({
          name: channel.group_title,
          title: channel.title,
          externalUrl: `acestream://${channel.acestream_id}`,
          behaviorHints: { notWebReady: true, external: true }
        });
      }

      if (channel.m3u8_url) {
        // m3u8 -> interno
        streams.push({
          name: channel.group_title,
          title: channel.title,
          url: channel.m3u8_url
        });
      }

      if (channel.stream_url) {
        // otros streams -> también interno
        streams.push({
          name: channel.group_title,
          title: channel.title,
          url: channel.stream_url
        });
      }

      // Streams adicionales
      if (channel.additional_streams && channel.additional_streams.length > 0) {
        channel.additional_streams.forEach(stream => {
          if (stream.acestream_id) {
            streams.push({
              name: stream.group_title,
              title: stream.title,
              externalUrl: `acestream://${stream.acestream_id}`,
              behaviorHints: { notWebReady: true, external: true }
            });
          } else if (stream.url) {
            streams.push({
              name: stream.group_title,
              title: stream.title,
              url: stream.url
            });
          } else if (stream.stream_url) {
            streams.push({
              name: stream.group_title,
              title: stream.title,
              url: stream.stream_url
            });
          }
        });
      }

      console.log("Streams generated:", streams);
      const response = { streams };
      cache.set(cacheKey, response);
      return response;
    } catch (error) {
      console.error('Stream error:', error);
      return { streams: [] };
    }
  }
  return { streams: [] };
});

// For development: serve the addon over HTTP
if (process.env.NODE_ENV !== 'production') {
  const { serveHTTP } = require('stremio-addon-sdk');
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

module.exports = (req, res) => {
  const addonInterface = builder.getInterface();
  const router = getRouter(addonInterface);
  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
