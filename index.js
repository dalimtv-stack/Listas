// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const bodyParser = require('body-parser');
const { getChannels, getChannel, loadM3U } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT } = require('./src/config');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.16',
  name: 'Heimdallr Channels',
  description: 'Addon para cargar canales Acestream o M3U8 desde una lista M3U proporcionada por el usuario.',
  types: ['tv'],
  logo: 'https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960',
  resources: ['stream', 'meta', 'catalog'],
  idPrefixes: ['heimdallr_'],
  catalogs: [
    {
      type: 'tv',
      id: 'Heimdallr',
      name: 'Heimdallr Live Channels',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'genre', isRequired: false, options: ['Adultos','Elcano.top','Hulu.to','NEW LOOP','Noticias','Shickat.me','Telegram','Deportes','Movistar'] }
      ]
    }
  ],
  behaviorHints: { configurable: true }
};

const builder = new addonBuilder(manifest);

// Cargar M3U global al inicio
loadM3U().catch(err => console.error('Error cargando M3U inicial:', err));

builder.defineCatalogHandler(async ({ type, id, extra, url }) => {
  if (type !== 'tv' || id !== 'Heimdallr') return { metas: [] };
  
  const cacheKey = `catalog_${extra?.genre || ''}_${extra?.search || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channels = await getChannels();
    let filtered = channels;

    if (extra?.search) {
      const q = extra.search.toLowerCase();
      filtered = filtered.filter(c => c.name.toLowerCase().includes(q));
    }
    if (extra?.genre) {
      filtered = filtered.filter(c => 
        c.group_title === extra.genre || (c.extra_genres && c.extra_genres.includes(extra.genre))
      );
    }

    const metas = filtered.map(c => ({
      id: `heimdallr_${c.id}`,
      type: 'tv',
      name: c.name,
      poster: c.logo_url
    }));

    const response = { metas };
    cache.set(cacheKey, response);
    return response;
  } catch (err) {
    console.error(err);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ type, id }) => {
  if (!id.startsWith('heimdallr_')) return { meta: null };
  const channelId = id.replace('heimdallr_', '');
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
    console.error(err);
    return { meta: null };
  }
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (!id.startsWith('heimdallr_')) return { streams: [] };
  const channelId = id.replace('heimdallr_', '');
  const cacheKey = `stream_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channel = await getChannel(channelId);
    const streams = [];

    if (channel.acestream_id) streams.push({
      name: channel.group_title,
      externalUrl: `acestream://${channel.acestream_id}`,
      behaviorHints: { notWebReady: true, external: true }
    });
    if (channel.m3u8_url) streams.push({
      name: channel.group_title,
      url: channel.m3u8_url,
      behaviorHints: { notWebReady: false, external: false }
    });

    if (channel.additional_streams) {
      channel.additional_streams.forEach(s => {
        const obj = { name: s.group_title, title: s.title };
        if (s.acestream_id) obj.externalUrl = `acestream://${s.acestream_id}`;
        else if (s.url) obj.url = s.url;
        streams.push(obj);
      });
    }

    const response = { streams };
    cache.set(cacheKey, response);
    return response;
  } catch (err) {
    console.error(err);
    return { streams: [] };
  }
});

const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);
router.use(bodyParser.urlencoded({ extended: false }));

router.get('/configure', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <html><head><title>Configure Heimdallr</title></head>
    <body>
      <h1>Configure Heimdallr Channels</h1>
      <form action="/generate-url" method="post">
        <input type="text" name="m3uUrl" placeholder="https://example.com/list.m3u" required>
        <button type="submit">Generate Install URL</button>
      </form>
    </body></html>
  `);
});

router.post('/generate-url', (req, res) => {
  const m3uUrl = req.body?.m3uUrl;
  if (!m3uUrl) return res.status(400).send('M3U URL required');

  const baseUrl = `https://listas-sand.vercel.app/${encodeURIComponent(m3uUrl)}/manifest.json`;
  const installUrl = `stremio://${encodeURIComponent(baseUrl)}`;

  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <html>
      <body>
        <h1>Install URL</h1>
        <a href="${installUrl}">Install Addon</a>
        <p>Manifest URL: <input type="text" value="${baseUrl}" readonly style="width:100%"></p>
      </body>
    </html>
  `);
});

// Servir manifest raíz
router.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(manifest));
});

if (process.env.NODE_ENV !== 'production') {
  const { serveHTTP } = require('stremio-addon-sdk');
  serveHTTP(addonInterface, { port: process.env.PORT || DEFAULT_PORT });
}

module.exports = (req, res) => {
  router(req, res, () => {
    res.statusCode = 404;
    res.end('Not found');
  });
};
