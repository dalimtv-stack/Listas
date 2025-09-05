// index.js
const { addonBuilder, getRouter, serveHTTP } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const bodyParser = require('body-parser');
const { getChannels, getChannel, loadM3U } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, ADDON_NAME, ADDON_ID, STREAM_PREFIX } = require('./src/config');

// Cache en memoria
const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Variable global temporal para guardar la M3U URL del usuario
let userM3uUrl = null;

// Cargar M3U por defecto al inicio
loadM3U().then(() => console.log('M3U cargado al inicio')).catch(err => console.error(err.message));

const manifest = {
  id: ADDON_ID,
  version: '1.2.150',
  name: ADDON_NAME,
  description: 'Addon para cargar canales Acestream o M3U8 desde una lista M3U proporcionada por el usuario.',
  types: ['tv'],
  logo: 'https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960',
  catalogs: [
    {
      type: 'tv',
      id: 'Heimdallr',
      name: 'Heimdallr Live Channels',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'genre', isRequired: false, options: ['Adultos','Noticias','Deportes','Movistar'] }
      ]
    }
  ],
  resources: ['stream', 'meta', 'catalog'],
  idPrefixes: [STREAM_PREFIX],
  behaviorHints: { configurable: true }
};

const builder = new addonBuilder(manifest);
const router = getRouter(builder.getInterface());
router.use(bodyParser.urlencoded({ extended: false }));

// ========================
// RUTAS DE CONFIGURACIÓN
// ========================
router.get('/configure', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Configure Heimdallr Channels</title>
      <style>
        body { font-family: Arial; max-width: 600px; margin: 20px auto; }
        input { width: 100%; padding: 10px; margin: 10px 0; }
        button { padding: 10px 20px; background: #4CAF50; color: white; border-radius: 5px; border: none; cursor: pointer; }
        pre { background: #f4f4f4; padding: 10px; border-radius: 5px; }
      </style>
      <script>
        function copyManifest() {
          navigator.clipboard.writeText(document.getElementById('manifestUrl').innerText)
            .then(() => alert('Manifest URL copied!'))
            .catch(err => alert('Copy failed: ' + err));
        }
      </script>
    </head>
    <body>
      <h1>Configure Heimdallr Channels</h1>
      <form action="/generate-url" method="post">
        <input type="text" name="m3uUrl" placeholder="https://example.com/list.m3u" required>
        <button type="submit">Generate Install URL</button>
      </form>
    </body>
    </html>
  `);
});

router.post('/generate-url', (req, res) => {
  if (!req.body || !req.body.m3uUrl) {
    res.statusCode = 400;
    res.end('M3U URL is required');
    return;
  }

  userM3uUrl = req.body.m3uUrl;
  const baseUrl = `https://listas-sand.vercel.app/generated-manifest.json`;
  const installUrl = `stremio://${encodeURIComponent(baseUrl)}`;
  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <h1>Install URL Generated</h1>
    <a href="${installUrl}" style="padding:10px 20px; background:#4CAF50;color:white;border-radius:5px;text-decoration:none;">Install Addon</a>
    <button onclick="navigator.clipboard.writeText('${baseUrl}')">Copy Manifest URL</button>
    <p>Manifest URL: <pre id="manifestUrl">${baseUrl}</pre></p>
  `);
});

// ========================
// HANDLERS DEL ADDON
// ========================
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== 'tv' || id !== 'Heimdallr') return { metas: [] };

  if (!userM3uUrl) return { metas: [] };
  const cacheKey = `catalog_${extra?.genre || ''}_${extra?.search || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  await loadM3U({ m3uUrl: userM3uUrl });
  let channels = await getChannels();

  if (extra?.search) {
    const q = extra.search.toLowerCase();
    channels = channels.filter(c => c.name.toLowerCase().includes(q));
  }
  if (extra?.genre) {
    channels = channels.filter(c => c.group_title === extra.genre || c.extra_genres?.includes(extra.genre));
  }

  const metas = channels.map(c => ({ id: `${STREAM_PREFIX}${c.id}`, type: 'tv', name: c.name, poster: c.logo_url }));
  const response = { metas };
  cache.set(cacheKey, response);
  return response;
});

builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== 'tv' || !id.startsWith(STREAM_PREFIX)) return { meta: null };
  const channelId = id.replace(STREAM_PREFIX, '');
  const cacheKey = `meta_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  await loadM3U({ m3uUrl: userM3uUrl });
  const channel = await getChannel(channelId);
  const response = {
    meta: {
      id, type: 'tv', name: channel.name, poster: channel.logo_url,
      background: channel.logo_url,
      description: channel.name
    }
  };
  cache.set(cacheKey, response);
  return response;
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== 'tv' || !id.startsWith(STREAM_PREFIX)) return { streams: [] };
  const channelId = id.replace(STREAM_PREFIX, '');
  const cacheKey = `stream_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  await loadM3U({ m3uUrl: userM3uUrl });
  const channel = await getChannel(channelId);

  const streams = channel.additional_streams.map(stream => {
    const s = { name: stream.group_title, title: stream.title };
    if (stream.acestream_id) s.externalUrl = `acestream://${stream.acestream_id}`, s.behaviorHints = { notWebReady: true, external: true };
    else if (stream.url || stream.stream_url) s.url = stream.url || stream.stream_url, s.behaviorHints = { notWebReady: false, external: false };
    return s;
  });

  cache.set(cacheKey, { streams });
  return { streams };
});

// ========================
// RUTA PARA MANIFEST DINÁMICO
// ========================
router.get('/generated-manifest.json', (req, res) => {
  if (!userM3uUrl) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'No M3U URL configured' }));
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(manifest));
});

// ========================
// INICIALIZACIÓN DEL SERVIDOR
// ========================
if (process.env.NODE_ENV !== 'production') {
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

module.exports = (req, res) => {
  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
