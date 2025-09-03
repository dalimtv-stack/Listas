// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require('./src/config');
const fs = require('fs');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Cargar manifest generado en build-time
let manifest;
try {
  manifest = require('./manifest.json');
  console.log('✅ manifest.json cargado correctamente');
} catch (err) {
  console.error('❌ No se pudo cargar manifest.json:', err);
  process.exit(1); // Fail early si no existe
}

const builder = new addonBuilder(manifest);

// Catalog handler
builder.defineCatalogHandler(async ({ type, id }) => {
  if (type === 'tv' && id === 'Heimdallr') {
    const cacheKey = 'Heimdallr_channels';
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const channels = await getChannels();
    const metas = channels.map(channel => ({
      id: `${STREAM_PREFIX}${channel.id}`,
      type: 'tv',
      name: channel.name,
      poster: channel.logo_url
    }));

    const response = { metas };
    cache.set(cacheKey, response);
    return response;
  }
  return { metas: [] };
});

// Meta handler
builder.defineMetaHandler(async ({ type, id }) => {
  if (type === 'tv' && id.startsWith(STREAM_PREFIX)) {
    const channelId = id.replace(STREAM_PREFIX, '');
    const cached = cache.get(`meta_${channelId}`);
    if (cached) return cached;

    const channel = await getChannel(channelId);
    const response = { meta: {
      id,
      type: 'tv',
      name: channel.name,
      poster: channel.logo_url,
      background: channel.logo_url,
      description: channel.name
    }};
    cache.set(`meta_${channelId}`, response);
    return response;
  }
  return { meta: null };
});

// Stream handler
builder.defineStreamHandler(async ({ type, id }) => {
  if (type === 'tv' && id.startsWith(STREAM_PREFIX)) {
    const channelId = id.replace(STREAM_PREFIX, '');
    const cached = cache.get(`stream_${channelId}`);
    if (cached) return cached;

    const channel = await getChannel(channelId);
    const streams = [];

    // Principal
    if (channel.acestream_id || channel.m3u8_url || channel.stream_url) {
      streams.push({
        name: channel.group_title,
        title: channel.title,
        url: channel.m3u8_url,
        externalUrl: channel.acestream_id ? `acestream://${channel.acestream_id}` : channel.stream_url,
        behaviorHints: {
          notWebReady: channel.acestream_id || channel.stream_url ? true : false,
          external: channel.acestream_id || channel.stream_url ? true : false
        }
      });
    }

    // Streams adicionales
    if (channel.additional_streams && channel.additional_streams.length > 0) {
      channel.additional_streams.forEach(s => {
        streams.push({
          name: s.group_title,
          title: s.title,
          url: s.url,
          externalUrl: s.acestream_id ? `acestream://${s.acestream_id}` : s.stream_url,
          behaviorHints: {
            notWebReady: s.acestream_id || s.stream_url ? true : false,
            external: s.acestream_id || s.stream_url ? true : false
          }
        });
      });
    }

    const response = { streams };
    cache.set(`stream_${channelId}`, response);
    return response;
  }
  return { streams: [] };
});

// Serve HTTP para desarrollo
if (process.env.NODE_ENV !== 'production') {
  const { serveHTTP } = require('stremio-addon-sdk');
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

// Export para Vercel
module.exports = (req, res) => {
  if (req.url === '/manifest.json') {
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(manifest));
    return;
  }
  const addonInterface = builder.getInterface();
  const router = getRouter(addonInterface);
  router(req,res,() => { res.statusCode=404; res.end(); });
};
