// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel, loadM3U } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require('./src/config');
// require('dotenv').config(); // Removido: innecesario en Vercel

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Cargar M3U globalmente al inicio para evitar recargas por request
loadM3U().then(() => {
  console.log('M3U cargado globalmente al inicio');
}).catch(err => {
  console.error('Error cargando M3U al inicio:', err);
});

const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.126',
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
        { name: 'search', isRequired: false },
        { name: 'genre', isRequired: false, options: ['Adultos', 'Elcano.top', 'Hulu.to', 'NEW LOOP', 'Noticias', 'Shickat.me', 'Telegram'] }
      ]
    }
  ],
  resources: ['stream', 'meta', 'catalog'],
  idPrefixes: [STREAM_PREFIX]
};

const builder = new addonBuilder(manifest);

// Catalog handler (con filtro seguro para género)
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  console.log('Catalog requested:', type, id, extra);

  if (type === 'tv' && id === 'Heimdallr') {
    const cacheKey = `Heimdallr_channels_${extra?.genre || ''}_${extra?.search || ''}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      console.log("Using cached catalog");
      return cached;
    }

    try {
      const channels = await getChannels(); // Ahora usa el caché global
      console.log("Fetched channels with group_titles:", channels.map(c => ({ id: c.id, name: c.name, group_title: c.group_title })));

      let filteredChannels = channels;

      // Filtro por búsqueda
      if (extra?.search) {
        const query = extra.search.toLowerCase();
        filteredChannels = filteredChannels.filter(channel => channel.name.toLowerCase().includes(query));
      }

      // Filtro por género (seguro: verifica additional_streams antes de .some)
      if (extra?.genre) {
        filteredChannels = filteredChannels.filter(channel => {
          if (channel.group_title === extra.genre) return true;
          if (channel.additional_streams && Array.isArray(channel.additional_streams)) {
            return channel.additional_streams.some(stream => stream.group_title === extra.genre);
          }
          return false;
        });
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
  }
  return { metas: [] };
});

// Meta handler (idéntico a tu funcional)
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

// Stream handler (idéntico a tu funcional, con streams no-m3u8 externos por ahora)
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

      // 1. Stream principal (si está disponible)
      if (channel.acestream_id || channel.m3u8_url || channel.stream_url) {
        streams.push({
          name: channel.additional_streams.length > 0 ? channel.additional_streams[0].group_title : channel.group_title, // Usar group_title del primer stream
          title: channel.title,
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
            name: stream.group_title, // Usar el group_title del stream adicional
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
