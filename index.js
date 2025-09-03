// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel } = require('./src/db');
const { CACHE_TTL = 1800, STREAM_PREFIX = 'heimdallr_' } = process.env;

const cache = new NodeCache({ stdTTL: CACHE_TTL });

let manifest;
try {
  manifest = require('./manifest.json');
  console.log('Loaded manifest.json from disk');
} catch (err) {
  console.error('manifest.json not found. Ejecuta node build-genres.js antes de subir a Vercel.');
  process.exit(1);
}

const builder = new addonBuilder(manifest);

// Catalog handler
builder.defineCatalogHandler(async ({ type, id }) => {
  if (type === 'tv' && id === 'Heimdallr') {
    const cacheKey = 'Heimdallr_channels';
    let cached = cache.get(cacheKey);
    if (cached) return cached;

    const channels = await getChannels();
    const metas = channels.map(c => ({
      id: `${STREAM_PREFIX}${c.id}`,
      type: 'tv',
      name: c.name,
      poster: c.logo_url
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
        name: channel.additional_streams[0]?.group_title || channel.group_title,
        title: channel.title,
        url: channel.m3u8_url,
        externalUrl: channel.acestream_id ? `acestream://${channel.acestream_id}` : channel.stream_url,
        behaviorHints: { notWebReady: !!(channel.acestream_id || channel.stream_url), external: !!(channel.acestream_id || channel.stream_url) }
      });
    }

    // Adicionales
    channel.additional_streams.forEach(s => {
      streams.push({
        name: s.group_title,
        title: s.title,
        url: s.url,
        externalUrl: s.acestream_id ? `acestream://${s.acestream_id}` : s.stream_url,
        behaviorHints: { notWebReady: !!(s.acestream_id || s.stream_url), external: !!(s.acestream_id || s.stream_url) }
      });
    });

    const response = { streams };
    cache.set(`stream_${channelId}`, response);
    return response;
  }
  return { streams: [] };
});

// Vercel export
module.exports = async (req, res) => {
  if (req.url === '/manifest.json') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(manifest));
    return;
  }

  const addonInterface = builder.getInterface();
  const router = getRouter(addonInterface);
  router(req, res, () => { res.statusCode = 404; res.end(); });
};
