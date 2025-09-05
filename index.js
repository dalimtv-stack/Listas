// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel, loadM3U } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, CONFIG_CACHE_TTL } = require('./src/config');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fetch = require('node-fetch');
require('dotenv').config();

const cache = new NodeCache({ stdTTL: CACHE_TTL });
const configCache = new NodeCache({ stdTTL: CONFIG_CACHE_TTL });

const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.161',
  name: 'Heimdallr Channels',
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
        { name: 'genre', isRequired: false, options: ['Adultos', 'Elcano.top', 'Hulu.to', 'NEW LOOP', 'Noticias', 'Shickat.me', 'Telegram', 'Deportes', 'Movistar'] }
      ]
    }
  ],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['heimdallr_'],
  behaviorHints: {
    configurable: true
  }
};

const builder = new addonBuilder(manifest);

// Definir manejadores antes de getInterface
console.log('Defining catalog handler');
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  console.log('Catalog requested:', { type, id, extra });
  const configId = extra?.configId || 'none';
  const m3uUrl = getM3uUrlFromConfigId(configId);
  console.log('Catalog configId:', configId, 'm3uUrl:', m3uUrl || 'none');
  if (type === 'tv' && id === 'Heimdallr') {
    const m3uHash = m3uUrl ? crypto.createHash('md5').update(m3uUrl).digest('hex') : 'default';
    const cacheKey = `Heimdallr_channels_${m3uHash}_${extra?.genre || ''}_${extra?.search || ''}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('Using cached catalog');
      return cached;
    }
    try {
      const channels = await getChannels({ m3uUrl });
      console.log('Fetched channels:', channels.map(c => ({ id: c.id, name: c.name, group_title: c.group_title, extra_genres: c.extra_genres })));
      let filteredChannels = channels;
      if (extra?.search) {
        const query = extra.search.toLowerCase();
        filteredChannels = filteredChannels.filter(channel => channel.name.toLowerCase().includes(query));
      }
      if (extra?.genre) {
        filteredChannels = filteredChannels.filter(channel => {
          if (channel.group_title === extra.genre) return true;
          if (channel.additional_streams && Array.isArray(channel.additional_streams)) {
            if (channel.additional_streams.some(stream => stream.group_title === extra.genre)) return true;
          }
          if (channel.extra_genres && Array.isArray(channel.extra_genres)) {
            if (channel.extra_genres.includes(extra.genre)) return true;
          }
          return false;
        });
      }
      const metas = filteredChannels.map(channel => ({
        id: `heimdallr_${channel.id}`,
        type: 'tv',
        name: channel.name,
        poster: channel.logo_url
      }));
      const response = { metas };
      cache.set(cacheKey, response);
      console.log('Catalog response:', response);
      return response;
    } catch (error) {
      console.error('Catalog error:', error.message);
      return { metas: [] };
    }
  }
  return { metas: [] };
});

console.log('Defining meta handler');
builder.defineMetaHandler(async ({ type, id, extra }) => {
  console.log('Meta requested:', { type, id, extra });
  const configId = extra?.configId || 'none';
  const m3uUrl = getM3uUrlFromConfigId(configId);
  console.log('Meta configId:', configId, 'm3uUrl:', m3uUrl || 'none');
  if (type === 'tv' && id.startsWith('heimdallr_')) {
    const channelId = id.replace('heimdallr_', '');
    const m3uHash = m3uUrl ? crypto.createHash('md5').update(m3uUrl).digest('hex') : 'default';
    const cacheKey = `meta_${m3uHash}_${channelId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    try {
      const channel = await getChannel(channelId, { m3uUrl });
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
      console.error('Meta error:', error.message);
      return { meta: null };
    }
  }
  return { meta: null };
});

console.log('Defining stream handler');
builder.defineStreamHandler(async ({ type, id, extra }) => {
  console.log('Stream requested:', { type, id, extra });
  const configId = extra?.configId || 'none';
  const m3uUrl = getM3uUrlFromConfigId(configId);
  console.log('Stream configId:', configId, 'm3uUrl:', m3uUrl || 'none');
  if (type === 'tv' && id.startsWith('heimdallr_')) {
    const channelId = id.replace('heimdallr_', '');
    const m3uHash = m3uUrl ? crypto.createHash('md5').update(m3uUrl).digest('hex') : 'default';
    const cacheKey = `stream_${m3uHash}_${channelId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('Using cached streams');
      return cached;
    }
    try {
      const channel = await getChannel(channelId, { m3uUrl });
      const streams = [];
      if (channel.acestream_id || channel.m3u8_url || channel.stream_url) {
        const streamObj = {
          name: channel.additional_streams && channel.additional_streams.length > 0 ? channel.additional_streams[0].group_title : channel.group_title,
          title: channel.title
        };
        if (channel.acestream_id) {
          streamObj.externalUrl = `acestream://${channel.acestream_id}`;
          streamObj.behaviorHints = { notWebReady: true, external: true };
        } else if (channel.m3u8_url) {
          streamObj.url = channel.m3u8_url;
          streamObj.behaviorHints = { notWebReady: false, external: false };
        } else if (channel.stream_url) {
          streamObj.url = channel.stream_url;
          streamObj.behaviorHints = { notWebReady: false, external: false };
        }
        streams.push(streamObj);
      }
      if (channel.additional_streams && Array.isArray(channel.additional_streams)) {
        channel.additional_streams.forEach((stream) => {
          const streamObj = {
            name: stream.group_title,
            title: stream.title
          };
          if (stream.acestream_id) {
            streamObj.externalUrl = `acestream://${stream.acestream_id}`;
            streamObj.behaviorHints = { notWebReady: true, external: true };
          } else if (stream.url) {
            streamObj.url = stream.url;
            streamObj.behaviorHints = { notWebReady: false, external: false };
          } else if (stream.stream_url) {
            streamObj.url = stream.stream_url;
            streamObj.behaviorHints = { notWebReady: false, external: false };
          }
          streams.push(streamObj);
        });
      }
      if (channel.website_url) {
        streams.push({
          title: `${channel.name} - Website`,
          externalUrl: channel.website_url,
          behaviorHints: { notWebReady: true, external: true }
        });
      }
      console.log('Streams generated:', streams);
      const response = { streams };
      cache.set(cacheKey, response);
      return response;
    } catch (error) {
      console.error('Stream error:', error.message);
      return { streams: [] };
    }
  }
  return { streams: [] };
});

// Inicializar addonInterface y router después de los manejadores
console.log('Creating addon interface and router');
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

// Obtener m3uUrl desde configCache
function getM3uUrlFromConfigId(configId) {
  if (!configId || configId === 'none') {
    console.log('No configId provided, using default M3U URL');
    return null;
  }
  const m3uUrl = configCache.get(configId);
  console.log('Retrieved m3uUrl for configId:', configId, m3uUrl || 'not found');
  return m3uUrl || null;
}

// Validar URL del M3U
async function validateM3uUrl(m3uUrl) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(m3uUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    console.log('Validated M3U URL:', m3uUrl, 'Status:', res.status);
    return res.ok;
  } catch (err) {
    console.error('Invalid M3U URL:', err.message);
    return false;
  }
}

// Manifest handler para rutas estáticas
router.get('/manifest.json', (req, res) => {
  console.log('Static manifest requested, configId:', req.params.configId || req.configId || 'none', 'URL:', req.url);
  try {
    const configId = req.params.configId || req.configId || 'none';
    const m3uUrl = getM3uUrlFromConfigId(configId);
    console.log('Serving static manifest with configId:', configId, 'm3uUrl:', m3uUrl || 'none');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(manifest));
  } catch (err) {
    console.error('Error serving static manifest:', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Failed to generate manifest', details: err.message }));
  }
});

// Manifest handler para rutas dinámicas
router.get('/:configId/manifest.json', (req, res) => {
  console.log('Dynamic manifest requested, configId:', req.params.configId, 'URL:', req.url);
  try {
    const configId = req.params.configId;
    const m3uUrl = getM3uUrlFromConfigId(configId);
    console.log('Serving dynamic manifest with configId:', configId, 'm3uUrl:', m3uUrl || 'none');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(manifest));
  } catch (err) {
    console.error('Error serving dynamic manifest:', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Failed to generate manifest', details: err.message }));
  }
});

// Manejadores explícitos para rutas dinámicas de catalog, meta y stream (con y sin .json)
router.get('/:configId/catalog/:type/:id', (req, res) => {
  console.log('Catalog route requested, configId:', req.params.configId, 'type:', req.params.type, 'id:', req.params.id, 'URL:', req.url, 'query:', req.query);
  req.configId = req.params.configId;
  const extra = { configId: req.params.configId, ...req.query };
  addonInterface.catalog({ ...req, extra }, res);
});

router.get('/:configId/catalog/:type/:id.json', (req, res) => {
  console.log('Catalog route (JSON) requested, configId:', req.params.configId, 'type:', req.params.type, 'id:', req.params.id, 'URL:', req.url, 'query:', req.query);
  req.configId = req.params.configId;
  const extra = { configId: req.params.configId, ...req.query };
  addonInterface.catalog({ ...req, extra }, res);
});

router.get('/:configId/meta/:type/:id', (req, res) => {
  console.log('Meta route requested, configId:', req.params.configId, 'type:', req.params.type, 'id:', req.params.id, 'URL:', req.url, 'query:', req.query);
  req.configId = req.params.configId;
  const extra = { configId: req.params.configId, ...req.query };
  addonInterface.meta({ ...req, extra }, res);
});

router.get('/:configId/meta/:type/:id.json', (req, res) => {
  console.log('Meta route (JSON) requested, configId:', req.params.configId, 'type:', req.params.type, 'id:', req.params.id, 'URL:', req.url, 'query:', req.query);
  req.configId = req.params.configId;
  const extra = { configId: req.params.configId, ...req.query };
  addonInterface.meta({ ...req, extra }, res);
});

router.get('/:configId/stream/:type/:id', (req, res) => {
  console.log('Stream route requested, configId:', req.params.configId, 'type:', req.params.type, 'id:', req.params.id, 'URL:', req.url, 'query:', req.query);
  req.configId = req.params.configId;
  const extra = { configId: req.params.configId, ...req.query };
  addonInterface.stream({ ...req, extra }, res);
});

router.get('/:configId/stream/:type/:id.json', (req, res) => {
  console.log('Stream route (JSON) requested, configId:', req.params.configId, 'type:', req.params.type, 'id:', req.params.id, 'URL:', req.url, 'query:', req.query);
  req.configId = req.params.configId;
  const extra = { configId: req.params.configId, ...req.query };
  addonInterface.stream({ ...req, extra }, res);
});

// Configurar rutas adicionales
router.use(bodyParser.urlencoded({ extended: false }));

router.get('/configure', (req, res) => {
  console.log('Serving /configure');
  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Configure Heimdallr Channels</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; }
          input { width: 100%; padding: 10px; margin: 10px 0; }
          button { background: #4CAF50; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin-right: 10px; }
          a { display: inline-block; margin-top: 20px; text-decoration: none; color: #4CAF50; }
          pre { background: #f4f4f4; padding: 10px; border-radius: 5px; }
        </style>
      </head>
      <body>
        <h1>Configure Heimdallr Channels</h1>
        <p>Enter the URL of your M3U playlist:</p>
        <form action="/generate-url" method="post">
          <input type="text" name="m3uUrl" placeholder="https://example.com/list.m3u" required>
          <button type="submit">Generate Install URL</button>
        </form>
      </body>
    </html>
  `);
});

router.post('/generate-url', async (req, res) => {
  console.log('POST /generate-url received, body:', req.body);
  try {
    if (!req.body || !req.body.m3uUrl) {
      console.error('No m3uUrl provided');
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/html');
      res.end(`
        <html>
          <body>
            <h1>Error</h1>
            <p>M3U URL is required. <a href="/configure">Go back</a></p>
          </body>
        </html>
      `);
      return;
    }

    const m3uUrl = req.body.m3uUrl;
    console.log('m3uUrl:', m3uUrl);

    // Validar URL
    const isValid = await validateM3uUrl(m3uUrl);
    if (!isValid) {
      console.error('Invalid M3U URL:', m3uUrl);
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/html');
      res.end(`
        <html>
          <body>
            <h1>Error</h1>
            <p>Invalid M3U URL. <a href="/configure">Go back</a></p>
          </body>
        </html>
      `);
      return;
    }

    const configId = uuidv4();
    configCache.set(configId, m3uUrl);
    console.log('Stored configId:', configId, 'with m3uUrl:', m3uUrl);

    const baseUrl = `https://${req.headers.host}/${configId}/manifest.json`;
    const installUrl = `stremio://${encodeURIComponent(baseUrl)}`;
    const manifestJson = JSON.stringify(manifest, null, 2);
    console.log('baseUrl:', baseUrl);
    console.log('installUrl:', installUrl);

    res.setHeader('Content-Type', 'text/html');
    res.end(`
      <html>
        <head>
          <title>Install Heimdallr Channels</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; }
            button { background: #4CAF50; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin-right: 10px; }
            a { display: inline-block; margin-top: 20px; text-decoration: none; color: #4CAF50; }
            pre { background: #f4f4f4; padding: 10px; border-radius: 5px; }
          </style>
          <script>
            function copyManifest() {
              navigator.clipboard.writeText('${baseUrl}').then(() => {
                alert('Manifest URL copied to clipboard!');
              }).catch(err => {
                alert('Failed to copy: ' + err);
              });
            }
          </script>
        </head>
        <body>
          <h1>Install URL Generated</h1>
          <p>Click the buttons below to install the addon or copy the manifest URL:</p>
          <a href="${installUrl}" style="background: #4CAF50; color: white; padding: 10px 20px; border-radius: 5px;">Install Addon</a>
          <button onclick="copyManifest()">Copy Manifest URL</button>
          <p>Or copy this URL:</p>
          <pre>${baseUrl}</pre>
          <p>Manifest JSON:</p>
          <pre>${manifestJson}</pre>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Error in /generate-url:', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html');
    res.end(`
      <html>
        <body>
          <h1>Server Error</h1>
          <p>Error: ${err.message}. <a href="/configure">Go back</a></p>
        </body>
      </html>
    `);
  }
});

// Middleware para extraer configId
router.use((req, res, next) => {
  console.log('Middleware processing request, original URL:', req.url, 'params:', req.params, 'query:', req.query);
  if (req.params.configId) {
    req.configId = req.params.configId;
    console.log('Middleware extracted configId from params:', req.configId);
  } else {
    // Intentar extraer configId de la URL manualmente
    const match = req.url.match(/^\/([^/]+)(\/(manifest\.json|catalog\/.*|meta\/.*|stream\/.*))?$/);
    if (match && match[1]) {
      req.configId = match[1];
      console.log('Middleware extracted configId from URL:', req.configId);
    } else {
      req.configId = null;
      console.log('Middleware no configId found');
    }
  }
  console.log('Middleware proceeding with configId:', req.configId || 'none', 'URL:', req.url);
  next();
});

if (process.env.NODE_ENV !== 'production') {
  const { serveHTTP } = require('stremio-addon-sdk');
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

module.exports = (req, res) => {
  console.log('Main handler received request, URL:', req.url, 'configId:', req.configId || 'none', 'params:', req.params, 'query:', req.query);
  router(req, res, () => {
    console.log('Route not found:', req.url);
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Route not found' }));
  });
};
