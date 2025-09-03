// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require('./src/config');
require('dotenv').config();
const fs = require('fs');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Cargar manifest.json generado en build-time
let manifest;
try {
  manifest = require('./manifest.json');
  console.log('Loaded manifest.json from disk');
} catch (err) {
  console.error('manifest.json no encontrado. Ejecuta "node build-genres.js" antes del deploy.');
  process.exit(1);
}

const builder = new addonBuilder(manifest);

// -------------------- Catalog Handler --------------------
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== 'tv' || id !== 'Heimdallr') return { metas: [] };

  const cacheKey = 'Heimdallr_channels';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channels = await getChannels();

    // Filtrar por género si existe
    let filteredChannels = channels;
    const genreExtra = extra?.find(e => e.name === 'genre')?.value;
    if (genreExtra) {
      filteredChannels = channels.filter(c => c.group_title === genreExtra);
    }

    const metas = filteredChannels.map(channel => ({
      id: `${STREAM_PREFIX}${channel.id}`,
      type: 'tv',
      name: channel.name,
      poster: channel.logo_url
    }));

    const response = { metas };
    cache.set(cacheKey, response);
    return response;
  } catch (error) {
    console.error('Catalog error:', error);
    return { metas: [] };
  }
});

// -------------------- Meta Handler --------------------
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
  } catch (error) {
    console.error('Meta error:', error);
    return { meta: null };
  }
});

// -------------------- Stream Handler --------------------
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
        name: channel.additional_streams.length > 0 ? channel.additional_streams[0].group_title : channel.group_title,
        title: channel.title,
        url: channel.m3u8_url,
        externalUrl: channel.acestream_id ? `acestream://${channel.acestream_id}` : channel.stream_url,
        behaviorHints: {
          notWebReady: !!(channel.acestream_id || channel.stream_url),
          external: !!(channel.acestream_id || channel.stream_url)
        }
      });
    }

    // Streams adicionales
    if (channel.additional_streams?.length > 0) {
      channel.additional_streams.forEach(stream => {
        streams.push({
          name: stream.group_title,
          title: stream.title,
          url: stream.url,
          externalUrl: stream.acestream_id ? `acestream://${stream.acestream_id}` : stream.stream_url,
          behaviorHints: {
            notWebReady: !!(stream.acestream_id || stream.stream_url),
            external: !!(stream.acestream_id || stream.stream_url)
          }
        });
      });
    }

    // Website URL opcional
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
  } catch (error) {
    console.error('Stream error:', error);
    return { streams: [] };
  }
});

// -------------------- Servir HTTP (para desarrollo y Vercel) --------------------
if (process.env.NODE_ENV !== 'production') {
  const { serveHTTP } = require('stremio-addon-sdk');
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

// Export para Vercel
module.exports = (req, res) => {
  // Soporte para /manifest.json si Vercel no sirve archivos estáticos
  if (req.url === '/manifest.json') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(manifest));
    return;
  }

  const addonInterface = builder.getInterface();
  const router = getRouter(addonInterface);
  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
