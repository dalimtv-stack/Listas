// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel, loadM3U } = require('../src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX, ADDON_NAME, ADDON_ID } = require('../src/config');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fetch = require('node-fetch');
require('dotenv').config();

const cache = new NodeCache({ stdTTL: CACHE_TTL });

const baseManifest = {
  id: ADDON_ID,
  version: '1.2.186',
  name: ADDON_NAME,
  description: 'Addon para cargar canales Acestream o M3U8 desde una lista M3U proporcionada por el usuario.',
  types: ['tv'],
  logo: 'https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960',
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['heimdallr_'],
  behaviorHints: {
    configurable: true
  },
  catalogs: [
    {
      type: 'tv',
      id: 'Heimdallr_none',
      name: 'Heimdallr Live Channels',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'genre', isRequired: false, options: ['Adultos', 'Elcano.top', 'Hulu.to', 'NEW LOOP', 'Noticias', 'Shickat.me', 'Telegram', 'Deportes', 'Movistar'] }
      ]
    }
  ]
};

const builder = new addonBuilder(baseManifest);

// Obtener m3uUrl desde Cloudflare Workers KV
async function getM3uUrlFromConfigId(configId) {
  if (!configId || configId === 'none') {
    console.log('[KV] No configId provided, returning null');
    return null;
  }
  try {
    console.log('[KV] Fetching m3uUrl from Cloudflare KV for configId:', configId);
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_KV_API_TOKEN}`,
        },
      }
    );
    const responseBody = await response.text();
    if (!response.ok) {
      console.error('[KV] Error fetching m3uUrl from Cloudflare KV:', response.status, response.statusText, responseBody);
      return null;
    }
    const m3uUrl = responseBody;
    console.log('[KV] Retrieved m3uUrl:', m3uUrl);
    return m3uUrl;
  } catch (err) {
    console.error('[KV] Error in getM3uUrlFromConfigId:', err.message, err.stack);
    return null;
  }
}

// Guardar m3uUrl en Cloudflare Workers KV
async function setM3uUrlInConfigId(configId, m3uUrl) {
  console.log('[KV] Storing in Cloudflare KV:', { configId, m3uUrl });
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_KV_API_TOKEN}`,
          'Content-Type': 'text/plain',
        },
        body: m3uUrl,
      }
    );
    const responseBody = await response.text();
    if (!response.ok) {
      console.error('[KV] Error setting m3uUrl in Cloudflare KV:', response.status, response.statusText, responseBody);
      throw new Error(`Failed to set m3uUrl in Cloudflare KV: ${response.status} ${response.statusText} - ${responseBody}`);
    }
    console.log('[KV] Successfully stored configId:', configId, 'with m3uUrl:', m3uUrl);
  } catch (err) {
    console.error('[KV] Error in setM3uUrlInConfigId:', err.message, err.stack);
    throw err;
  }
}

// Validar URL del M3U
async function validateM3uUrl(m3uUrl) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(m3uUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    console.log('[validate] Validated M3U URL:', m3uUrl, 'Status:', res.status);
    return res.ok;
  } catch (err) {
    console.error('[validate] Invalid M3U URL:', m3uUrl, err.message);
    return false;
  }
}

// Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  console.log('[catalog] Requested:', { type, id, extra });
  const configId = id.startsWith('Heimdallr_') ? id.split('_')[1] : 'none';
  const m3uUrl = await getM3uUrlFromConfigId(configId);
  console.log('[catalog] configId:', configId, 'm3uUrl:', m3uUrl || 'none');

  if (type === 'tv' && id.startsWith('Heimdallr_')) {
    const m3uHash = m3uUrl ? crypto.createHash('md5').update(m3uUrl).digest('hex') : 'default';
    const cacheKey = `Heimdallr_channels_${m3uHash}_${extra?.genre || ''}_${extra?.search || ''}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('[catalog] Using cached catalog');
      return cached;
    }
    try {
      const channels = await getChannels({ m3uUrl });
      console.log('[catalog] Fetched channels:', channels.length);
      let filteredChannels = channels;
      if (extra?.search) {
        const query = extra.search.toLowerCase();
        filteredChannels = filteredChannels.filter(channel => channel.name.toLowerCase().includes(query));
        console.log('[catalog] Filtered by search:', filteredChannels.length);
      }
      if (extra?.genre) {
        filteredChannels = filteredChannels.filter(channel => {
          if (channel.group_title === extra.genre) return true;
          if (channel.additional_streams?.some(stream => stream.group_title === extra.genre)) return true;
          if (channel.extra_genres?.includes(extra.genre)) return true;
          return false;
        });
        console.log('[catalog] Filtered by genre:', filteredChannels.length);
      }
      const metas = filteredChannels.map(channel => ({
        id: `heimdallr_${configId}_${channel.id}`,
        type: 'tv',
        name: channel.name,
        poster: channel.logo_url
      }));
      const response = { metas };
      cache.set(cacheKey, response);
      console.log('[catalog] Response:', { metas: metas.length });
      return response;
    } catch (error) {
      console.error('[catalog] Error:', error.message, error.stack);
      return { metas: [] };
    }
  }
  console.log('[catalog] Invalid request, returning empty metas');
  return { metas: [] };
});

// Meta handler
builder.defineMetaHandler(async ({ type, id, extra }) => {
  console.log('[meta] Requested:', { type, id, extra });
  const parts = id.split('_');
  const configId = parts[1] || 'none';
  const channelId = parts.slice(2).join('_');
  const m3uUrl = await getM3uUrlFromConfigId(configId);
  console.log('[meta] configId:', configId, 'm3uUrl:', m3uUrl || 'none', 'channelId:', channelId);

  if (type === 'tv' && id.startsWith('heimdallr_')) {
    const m3uHash = m3uUrl ? crypto.createHash('md5').update(m3uUrl).digest('hex') : 'default';
    const cacheKey = `meta_${m3uHash}_${channelId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('[meta] Using cached meta');
      return cached;
    }
    try {
      const channel = await getChannel(channelId, { m3uUrl });
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
      console.log('[meta] Response:', response);
      return response;
    } catch (error) {
      console.error('[meta] Error:', error.message, error.stack);
      return { meta: null };
    }
  }
  console.log('[meta] Invalid request, returning null meta');
  return { meta: null };
});

// Stream handler
builder.defineStreamHandler(async ({ type, id, extra }) => {
  console.log('[stream] Requested:', { type, id, extra });
  const parts = id.split('_');
  const configId = parts[1] || 'none';
  const channelId = parts.slice(2).join('_');
  const m3uUrl = await getM3uUrlFromConfigId(configId);
  console.log('[stream] configId:', configId, 'm3uUrl:', m3uUrl || 'none', 'channelId:', channelId);

  if (type === 'tv' && id.startsWith('heimdallr_')) {
    const m3uHash = m3uUrl ? crypto.createHash('md5').update(m3uUrl).digest('hex') : 'default';
    const cacheKey = `stream_${m3uHash}_${channelId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('[stream] Using cached streams');
      return cached;
    }
    try {
      const channel = await getChannel(channelId, { m3uUrl });
      const streams = [];

      if (channel.acestream_id || channel.m3u8_url || channel.stream_url) {
        const streamObj = {
          name: channel.additional_streams?.[0]?.group_title || channel.group_title,
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

      (channel.additional_streams || []).forEach((stream) => {
        const streamObj = {
          name: stream.group_title,
          title: stream.title
        };
        if (stream.acestream_id) {
          streamObj.externalUrl = `acestream://${stream.acestream_id}`;
          streamObj.behaviorHints = { notWebReady: true, external: true };
        } else if (stream.url || stream.stream_url) {
          streamObj.url = stream.url || stream.stream_url;
          streamObj.behaviorHints = { notWebReady: false, external: false };
        }
        streams.push(streamObj);
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
      console.log('[stream] Response:', { streams: streams.length });
      return response;
    } catch (error) {
      console.error('[stream] Error:', error.message, error.stack);
      return { streams: [] };
    }
  }
  console.log('[stream] Invalid request, returning empty streams');
  return { streams: [] };
});

// Configuración del router
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

// Middleware para parsear form-urlencoded
router.use(bodyParser.urlencoded({ extended: false }));

// Middleware para CORS
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }
  console.log('[router] Processing request:', req.method, req.url);
  next();
});

// Rutas estáticas
router.get('/configure', (req, res) => {
  console.log('[router] Serving /configure');
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
  console.log('[router] POST /generate-url', { body: req.body });
  try {
    if (!req.body?.m3uUrl) {
      console.error('[router] No m3uUrl provided');
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

    const m3uUrl = req.body.m3uUrl.trim();
    console.log(`[router] m3uUrl recibida: ${m3uUrl}`);
    const isValid = await validateM3uUrl(m3uUrl);
    if (!isValid) {
      console.error(`[router] URL inválida: ${m3uUrl}`);
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
    await setM3uUrlInConfigId(configId, m3uUrl);
    const baseUrl = `https://${req.headers.host}/${configId}/manifest.json`;
    const installUrl = `stremio://${encodeURIComponent(baseUrl)}`;
    console.log(`[router] baseUrl: ${baseUrl}, installUrl: ${installUrl}`);
    const manifestJson = JSON.stringify({
      ...baseManifest,
      catalogs: [
        {
          type: 'tv',
          id: `Heimdallr_${configId}`,
          name: 'Heimdallr Live Channels',
          extra: [
            { name: 'search', isRequired: false },
            { name: 'genre', isRequired: false, options: ['Adultos', 'Elcano.top', 'Hulu.to', 'NEW LOOP', 'Noticias', 'Shickat.me', 'Telegram', 'Deportes', 'Movistar'] }
          ]
        }
      ]
    }, null, 2);

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
          <p>Current M3U URL:</p>
          <pre>${m3uUrl}</pre>
          <p>Manifest JSON:</p>
          <pre>${manifestJson}</pre>
          <p>Debug KV URL:</p>
          <pre>https://${req.headers.host}/debug-kv/${configId}</pre>
        </body>
      </html>
    `);
  } catch (err) {
    console.error(`[router] Error in /generate-url: ${err.message}`, err.stack);
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

// Manejador para manifest.json
router.get('/manifest.json', async (req, res) => {
  console.log('[router] Manifest solicitado');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(baseManifest));
});

router.get('/:configId/manifest.json', async (req, res) => {
  console.log('[router] Manifest solicitado con configId:', req.params.configId);
  const configId = req.params.configId;
  const manifest = {
    ...baseManifest,
    catalogs: [
      {
        type: 'tv',
        id: `Heimdallr_${configId}`,
        name: 'Heimdallr Live Channels',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'genre', isRequired: false, options: ['Adultos', 'Elcano.top', 'Hulu.to', 'NEW LOOP', 'Noticias', 'Shickat.me', 'Telegram', 'Deportes', 'Movistar'] }
        ]
      }
    ]
  };
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(manifest));
});

// Catalog routes (with and without configId prefix)
router.get('/catalog/:type/:id.json', (req, res) => {
  console.log('[router] Catalog solicitado:', req.url, req.params);
  const id = req.params.id.replace(/\.json$/, '');
  const configId = id.startsWith('Heimdallr_') ? id.split('_')[1] : 'none';
  console.log('[router] Catalog processed:', { type: req.params.type, id, configId, extra: req.query });
  addonInterface.catalog({ type: req.params.type, id, extra: { configId, ...req.query } }, res);
});

router.get('/:configId/catalog/:type/:id.json', (req, res) => {
  console.log('[router] Catalog con configId solicitado:', req.url, req.params);
  const id = req.params.id.replace(/\.json$/, '');
  const configId = req.params.configId || (id.startsWith('Heimdallr_') ? id.split('_')[1] : 'none');
  console.log('[router] Catalog con configId processed:', { type: req.params.type, id, configId, extra: req.query });
  addonInterface.catalog({ type: req.params.type, id, extra: { configId, ...req.query } }, res);
});

// Meta routes (with and without configId prefix)
router.get('/meta/:type/:id.json', (req, res) => {
  console.log('[router] Meta solicitado:', req.url, req.params);
  const id = req.params.id.replace(/\.json$/, '');
  const configId = id.split('_')[1] || 'none';
  console.log('[router] Meta processed:', { type: req.params.type, id, configId, extra: req.query });
  addonInterface.meta({ type: req.params.type, id, extra: { configId, ...req.query } }, res);
});

router.get('/:configId/meta/:type/:id.json', (req, res) => {
  console.log('[router] Meta con configId solicitado:', req.url, req.params);
  const id = req.params.id.replace(/\.json$/, '');
  const configId = req.params.configId || (id.split('_')[1] || 'none');
  console.log('[router] Meta con configId processed:', { type: req.params.type, id, configId, extra: req.query });
  addonInterface.meta({ type: req.params.type, id, extra: { configId, ...req.query } }, res);
});

// Stream routes (with and without configId prefix)
router.get('/stream/:type/:id.json', (req, res) => {
  console.log('[router] Stream solicitado:', req.url, req.params);
  const id = req.params.id.replace(/\.json$/, '');
  const configId = id.split('_')[1] || 'none';
  console.log('[router] Stream processed:', { type: req.params.type, id, configId, extra: req.query });
  addonInterface.stream({ type: req.params.type, id, extra: { configId, ...req.query } }, res);
});

router.get('/:configId/stream/:type/:id.json', (req, res) => {
  console.log('[router] Stream con configId solicitado:', req.url, req.params);
  const id = req.params.id.replace(/\.json$/, '');
  const configId = req.params.configId || (id.split('_')[1] || 'none');
  console.log('[router] Stream con configId processed:', { type: req.params.type, id, configId, extra: req.query });
  addonInterface.stream({ type: req.params.type, id, extra: { configId, ...req.query } }, res);
});

// Debug route for Cloudflare KV
router.get('/debug-kv/:configId', async (req, res) => {
  console.log('[router] Debug KV solicitado:', req.params.configId);
  const configId = req.params.configId;
  try {
    const m3uUrl = await getM3uUrlFromConfigId(configId);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ configId, m3uUrl: m3uUrl || 'none' }));
  } catch (err) {
    console.error('[router] Error in debug-kv:', err.message, err.stack);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.message }));
  }
});

if (process.env.NODE_ENV !== 'production') {
  const { serveHTTP } = require('stremio-addon-sdk');
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

module.exports = (req, res) => {
  console.log('[server] Solicitud recibida:', req.method, req.url);
  router(req, res, () => {
    console.log('[server] Ruta no encontrada:', req.method, req.url);
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Route not found' }));
  });
};
