// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel, getGenres } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require('./src/config');
require('dotenv').config();

const cache = new NodeCache({ stdTTL: CACHE_TTL });

const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.125',
  name: 'Heimdallr Channels',
  description: 'Addon para cargar canales Acestream o M3U8 desde una lista M3U.',
  types: ['tv'],
  logo: "https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960",
  catalogs: [
    {
      type: 'tv',
      id: 'Heimdallr',
      name: 'Heimdallr Live Channels',
      extra: [{ name: 'search' }, { name: 'genre', options: [], isRequired: false }]
    }
  ],
  resources: ['stream', 'meta', 'catalog'],
  idPrefixes: [STREAM_PREFIX]
};

const builder = new addonBuilder(manifest);

// Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== 'tv' || id !== 'Heimdallr') return { metas: [] };

  const cacheKey = 'Heimdallr_channels';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channels = await getChannels();

    // Dinámicamente actualizar géneros en manifest
    const genres = await getGenres();
    manifest.catalogs[0].extra.find(e => e.name === 'genre').options = genres;

    let filtered = channels;
    if (extra && extra.genre) {
      filtered = channels.filter(c => c.group_title === extra.genre || (c.additional_streams && c.additional_streams.some(s => s.group_title === extra.genre)));
    }

    const metas = filtered.map(channel => ({
      id: `${STREAM_PREFIX}${channel.id}`,
      type: 'tv',
      name: channel.name,
      poster: channel.logo_url
    }));

    const response = { metas };
    cache.set(cacheKey, response);
    return response;
  } catch (err) {
    console.error("Catalog error:", err);
    return { metas: [] };
  }
});

// Meta handler
builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== 'tv' || !id.startsWith(STREAM_PREFIX)) return { meta: null };

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
        poster: channel.logo_url,
        background: channel.logo_url,
        description: channel.name
      }
    };
    cache.set(cacheKey, response);
    return response;
  } catch (err) {
    console.error("Meta error:", err);
    return { meta: null };
  }
});

// Stream handler
builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== 'tv' || !id.startsWith(STREAM_PREFIX)) return { streams: [] };

  const channelId = id.replace(STREAM_PREFIX, '');
  const cacheKey = `stream_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channel = await getChannel(channelId);
    const streams = [];

    // Stream principal
    if (channel.acestream_id || channel.m3u8_url || channel.stream_url) {
      streams.push({
        name: channel.additional_streams[0]?.group_title || channel.group_title,
        title: channel.title,
        url: channel.m3u8_url,
        externalUrl: channel.acestream_id ? `acestream://${channel.acestream_id}` : channel.stream_url,
        behaviorHints: { notWebReady: !!(channel.acestream_id || channel.stream_url), external: !!(channel.acestream_id || channel.stream_url) }
      });
    }

    // Streams adicionales
    if (channel.additional_streams) {
      channel.additional_streams.forEach(stream => {
        streams.push({
          name: stream.group_title,
          title: stream.title,
          url: stream.url,
          externalUrl: stream.acestream_id ? `acestream://${stream.acestream_id}` : stream.stream_url,
          behaviorHints: { notWebReady: !!(stream.acestream_id || stream.stream_url), external: !!(stream.acestream_id || stream.stream_url) }
        });
      });
    }

    if (channel.website_url) {
      streams.push({
        title: `${channel.name} - Website`,
        externalUrl: channel.website_url,
        behaviorHints: { notWebReady: true, external: true }
      });
    }

    const response = { streams };
    cache.set(cacheKey, response);
    return response;
  } catch (err) {
    console.error("Stream error:", err);
    return { streams: [] };
  }
});

// Development server
if (process.env.NODE_ENV !== 'production') {
  const { serveHTTP } = require('stremio-addon-sdk');
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

// Export para Vercel
module.exports = (req, res) => {
  const addonInterface = builder.getInterface();
  const router = getRouter(addonInterface);
  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
