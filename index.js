const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require('./src/config');
require('dotenv').config();

const cache = new NodeCache({ stdTTL: CACHE_TTL });

const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.6',
  name: 'Heimdallr Channels',
  description: 'Addon para cargar canales Acestream o M3U8 desde una lista M3U configurable por el usuario.',
  types: ['tv'],
  logo: "https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960",
  catalogs: [
    {
      type: 'tv',
      id: 'Heimdallr',
      name: 'Heimdallr Live Channels',
      extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
    }
  ],
  resources: ['stream', 'meta', 'catalog'],
  idPrefixes: [STREAM_PREFIX],
  config: [
    {
      key: 'm3u_url',
      type: 'text',
      title: 'M3U URL',
      description: 'Introduce la URL de la lista M3U (deja vacío para usar la predeterminada)',
      default: 'https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u'
    }
  ]
};

const builder = new addonBuilder(manifest);

// Catalog handler
builder.defineCatalogHandler(async ({ type, id, config }) => {
  console.log('Catalog requested:', type, id, 'Config received:', JSON.stringify(config));

  if (type === 'tv' && id === 'Heimdallr') {
    const cacheKey = 'Heimdallr_channels';
    const cached = cache.get(cacheKey);
    const m3uUrl = config?.m3u_url || manifest.config[0].default;
    console.log('Using M3U URL:', m3uUrl);

    if (cached) {
      console.log("Using cached catalog");
      return cached;
    }

    try {
      const channels = await getChannels(m3uUrl);
      console.log("Fetched channels count:", channels.length);

      const metas = channels.map(channel => ({
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
  }
  return { metas: [] };
});

// Meta handler
builder.defineMetaHandler(async ({ type, id, config }) => {
  console.log('Meta requested:', type, id, 'Config received:', JSON.stringify(config));

  if (type === 'tv' && id.startsWith(STREAM_PREFIX)) {
    const channelId = id.replace(STREAM_PREFIX, '');
    const cacheKey = `meta_${channelId}`;
    const cached = cache.get(cacheKey);
    const m3uUrl = config?.m3u_url || manifest.config[0].default;
    console.log('Using M3U URL for meta:', m3uUrl);

    if (cached) return cached;

    try {
      const channel = await getChannel(channelId, m3uUrl);
      const response = {
        meta: {
          id: id,
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
  }
  return { meta: null };
});

// Stream handler with Acestream support
builder.defineStreamHandler(async ({ type, id, config }) => {
  console.log('Stream requested:', type, id, 'Config received:', JSON.stringify(config));

  if (type === 'tv' && id.startsWith(STREAM_PREFIX)) {
    const channelId = id.replace(STREAM_PREFIX, '');
    const cacheKey = `stream_${channelId}`;
    const cached = cache.get(cacheKey);
    const m3uUrl = config?.m3u_url || manifest.config[0].default;
    console.log('Using M3U URL for stream:', m3uUrl);

    if (cached) {
      console.log("Using cached streams");
      return cached;
    }

    try {
      const channel = await getChannel(channelId, m3uUrl);
      const streams = [];

      if (channel.acestream_id || channel.m3u8_url || channel.stream_url) {
        streams.push({
          name: channel.additional_streams.length > 0 ? channel.additional_streams[0].group_title : channel.group_title,
          title: channel.title,
          url: channel.m3u8_url,
          externalUrl: channel.acestream_id ? `acestream://${channel.acestream_id}` : channel.stream_url,
          behaviorHints: {
            notWebReady: channel.acestream_id || channel.stream_url ? true : false,
            external: channel.acestream_id || channel.stream_url ? true : false
          }
        });
      }

      if (channel.additional_streams && channel.additional_streams.length > 0) {
        channel.additional_streams.forEach((stream, index) => {
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
      }

      if (channel.website_url) {
        streams.push({
          title: `${channel.name} - Website`,
          externalUrl: channel.website_url,
          behaviorHints: {
            notWebReady: true,
            external: true
          }
        });
      }

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
