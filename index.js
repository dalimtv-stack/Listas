const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require('./src/config');
require('dotenv').config();

const cache = new NodeCache({ stdTTL: CACHE_TTL });

const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.3.3', // Nueva versión con corrección de configurable
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
  configurable: [ // Cambiado de 'config' a 'configurable'
    {
      key: 'm3u_url',
      type: 'text',
      title: 'M3U URL',
      description: 'Introduce la URL de tu lista M3U (obligatorio para cargar canales)',
      default: '' // Sin URL predeterminada, el usuario debe ingresarla
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
    const m3uUrl = config?.m3u_url || '';
    console.log('Using M3U URL:', m3uUrl);

    if (!m3uUrl) {
      console.warn('No M3U URL provided, catalog will be empty');
      return { metas: [] }; // No cargar canales sin URL
    }

    if (cached) {
      console.log('Using cached catalog');
      return cached;
    }

    try {
      const channels = await getChannels(m3uUrl);
      console.log('Fetched channels:', channels.map(c => ({ id: c.id, name: c.name, group_title: c.group_title })));

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
    const m3uUrl = config?.m3u_url || '';
    console.log('Using M3U URL for meta:', m3uUrl);

    if (!m3uUrl) {
      console.warn('No M3U URL provided, meta will be null');
      return { meta: null }; // No cargar metadatos sin URL
    }

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
    const m3uUrl = config?.m3u_url || '';
    console.log('Using M3U URL for stream:', m3uUrl);

    if (!m3uUrl) {
      console.warn('No M3U URL provided, streams will be empty');
      return { streams: [] }; // No cargar streams sin URL
    }

    if (cached) {
      console.log('Using cached streams');
      return cached;
    }

    try {
      const channel = await getChannel(channelId, m3uUrl);
      const streams = [];

      // 1. Stream principal (si está disponible)
      if (channel.acestream_id || channel.m3u8_url || channel.stream_url) {
        streams.push({
          name: channel.additional_streams.length > 0 ? channel.additional_streams[0].group_title : channel.group_title || 'Default Group',
          title: channel.title || `${channel.name} (Principal)`,
          url: channel.m3u8_url,
          externalUrl: channel.acestream_id ? `acestream://${channel.acestream_id}` : channel.stream_url,
          behaviorHints: {
            notWebReady: channel.acestream_id || channel.stream_url ? true : false,
            external: channel.acestream_id || channel.stream_url ? true : false
          }
        });
      }

      // 2. Streams adicionales
      if (channel.additional_streams && channel.additional_streams.length > 0) {
        channel.additional_streams.forEach((stream, index) => {
          streams.push({
            name: stream.group_title || channel.group_title || 'Default Group',
            title: stream.title, // Usar el título original con tipo (ej: "Movistar Liga (Acestream)")
            url: stream.url,
            externalUrl: stream.acestream_id ? `acestream://${stream.acestream_id}` : stream.stream_url,
            behaviorHints: {
              notWebReady: stream.acestream_id || stream.stream_url ? true : false,
              external: stream.acestream_id || stream.stream_url ? true : false
            }
          });
        });
      }

      // 3. Website URL (si está disponible)
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

      console.log('Streams generated:', streams);
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
