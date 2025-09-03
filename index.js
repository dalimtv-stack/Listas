// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel, getGenres } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require('./src/config');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Generar manifest dinámico
async function createManifest() {
  const genres = await getGenres();
  return {
    id: 'org.stremio.Heimdallr',
    version: '1.3.001',
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
          { name: 'genre', options: genres, isRequired: false }
        ]
      }
    ],
    resources: ['stream', 'meta', 'catalog'],
    idPrefixes: [STREAM_PREFIX]
  };
}

let builderPromise = createManifest().then(manifest => new addonBuilder(manifest));

// Catalog handler
async function catalogHandler({ type, id }) {
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
}

// Meta handler
async function metaHandler({ type, id }) {
  if (type === 'tv' && id.startsWith(STREAM_PREFIX)) {
    const channelId = id.replace(STREAM_PREFIX, '');
    const cacheKey = `meta_${channelId}`;
    const cached = cache.get(cacheKey);
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
    cache.set(cacheKey, response);
    return response;
  }
  return { meta: null };
}

// Stream handler
async function streamHandler({ type, id }) {
  if (type === 'tv' && id.startsWith(STREAM_PREFIX)) {
    const channelId = id.replace(STREAM_PREFIX, '');
    const cacheKey = `stream_${channelId}`;
    const cached = cache.get(cacheKey);
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
          notWebReady: channel.acestream_id || channel.stream_url ? true : false,
          external: channel.acestream_id || channel.stream_url ? true : false
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
          notWebReady: stream.acestream_id || stream.stream_url ? true : false,
          external: stream.acestream_id || stream.stream_url ? true : false
        }
      });
    });

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
  }
  return { streams: [] };
}

// Export para Vercel
module.exports = async (req, res) => {
  const builder = await builderPromise;
  const addonInterface = builder.getInterface();

  if (req.url === '/manifest.json') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(addonInterface.manifest));
    return;
  }

  const router = getRouter(addonInterface);
  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
