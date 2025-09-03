// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require('./src/config');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Leer manifest ya generado
let manifest = require('./manifest.json');
const builder = new addonBuilder(manifest);

// Catalog / Meta / Stream handlers (igual que tu versión estable)
builder.defineCatalogHandler(async ({ type, id }) => {
  if (type === 'tv' && id === 'Heimdallr') {
    const cached = cache.get('Heimdallr_channels');
    if (cached) return cached;

    const channels = await getChannels();
    const metas = channels.map(c => ({
      id: `${STREAM_PREFIX}${c.id}`,
      type: 'tv',
      name: c.name,
      poster: c.logo_url
    }));

    const response = { metas };
    cache.set('Heimdallr_channels', response);
    return response;
  }
  return { metas: [] };
});

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

builder.defineStreamHandler(async ({ type, id }) => {
  if (type === 'tv' && id.startsWith(STREAM_PREFIX)) {
    const channelId = id.replace(STREAM_PREFIX, '');
    const cached = cache.get(`stream_${channelId}`);
    if (cached) return cached;

    const channel = await getChannel(channelId);
    const streams = [];

    if (channel.acestream_id || channel.m3u8_url || channel.stream_url) {
      streams.push({
        name: channel.additional_streams[0]?.group_title || channel.group_title,
        title: channel.title,
        url: channel.m3u8_url,
        externalUrl: channel.acestream_id ? `acestream://${channel.acestream_id}` : channel.stream_url,
        behaviorHints: {
          notWebReady: !!(channel.acestream_id || channel.stream_url),
          external: !!(channel.acestream_id || channel.stream_url)
        }
      });
    }

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

    const response = { streams };
    cache.set(`stream_${channelId}`, response);
    return response;
  }
  return { streams: [] };
});

// Vercel handler
module.exports = (req, res) => {
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
