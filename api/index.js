// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel, loadM3U } = require('../src/db');
const { CACHE_TTL, DEFAULT_PORT } = require('../src/config');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fetch = require('node-fetch');
require('dotenv').config();

const cache = new NodeCache({ stdTTL: CACHE_TTL });

const baseManifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.186',
  name: 'Heimdallr Channels',
  description: 'Addon para cargar canales Acestream o M3U8 desde una lista M3U proporcionada por el usuario.',
  types: ['tv'],
  logo: 'https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960',
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['heimdallr_'],
  behaviorHints: {
    configurable: true
  },
  catalogs: []
};

const builder = new addonBuilder(baseManifest);

// Obtener m3uUrl desde Cloudflare Workers KV
async function getM3uUrlFromConfigId(configId) {
  if (!configId || configId === 'none') {
    console.log('No configId provided, returning null');
    return null;
  }
  try {
    console.log('Fetching m3uUrl from Cloudflare KV for configId:', configId);
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
      console.error('Error fetching m3uUrl from Cloudflare KV:', response.status, response.statusText, responseBody);
      return null;
    }
    const m3uUrl = responseBody;
    console.log('Retrieved m3uUrl:', m3uUrl);
    return m3uUrl;
  } catch (err) {
    console.error('Error in getM3uUrlFromConfigId:', err.message);
    return null;
  }
}

// Guardar m3uUrl en Cloudflare Workers KV
async function setM3uUrlInConfigId(configId, m3uUrl) {
  try {
    console.log('Storing in Cloudflare KV:', { configId, m3uUrl });
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
      throw new Error(`Failed to set m3uUrl in Cloudflare KV: ${response.status} ${response.statusText} - ${responseBody}`);
    }
    console.log('Successfully stored configId:', configId, 'with m3uUrl:', m3uUrl);
  } catch (err) {
    console.error('Error in setM3uUrlInConfigId:', err.message);
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
    console.log('Validated M3U URL:', m3uUrl, 'Status:', res.status);
    return res.ok;
  } catch (err) {
    console.error('Invalid M3U URL:', err.message);
    return false;
  }
}
// Definir manejadores
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  console.log('Catalog requested:', { type, id, extra });

  // Extraer configId desde el ID del catálogo
  const configId = id.startsWith('Heimdallr_') ? id.split('_')[1] : 'none';
  const m3uUrl = await getM3uUrlFromConfigId(configId);
  console.log('Catalog configId:', configId, 'm3uUrl:', m3uUrl || 'none');

  if (type === 'tv' && id.startsWith('Heimdallr_')) {
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
          if (channel.additional_streams?.some(stream => stream.group_title === extra.genre)) return true;
          if (channel.extra_genres?.includes(extra.genre)) return true;
          return false;
        });
      }

      const metas = filteredChannels.map(channel => ({
        id: `heimdallr_${configId}_${channel.id}`, // 👈 ID con configId embebido
        type: 'tv',
        name: channel.name,
        poster: channel.logo_url
      }));

      const response = { metas };
      cache.set(cacheKey, response);
      console.log('Catalog response:', response);
      return response;
    } catch (error) {
      console.error('Catalog error:', error.message, error.stack);
      return { metas: [] };
    }
  }

  console.log('Catalog not matched, returning empty metas');
  return { metas: [] };
});

builder.defineMetaHandler(async ({ type, id, extra }) => {
  console.log('Meta requested:', { type, id, extra });

  // Extraer configId y channelId desde el ID
  const parts = id.split('_');
  const configId = parts[1];
  const channelId = parts.slice(2).join('_');
  const m3uUrl = await getM3uUrlFromConfigId(configId);
  console.log('Meta configId:', configId, 'm3uUrl:', m3uUrl || 'none');

  if (type === 'tv') {
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
      console.error('Meta error:', error.message, error.stack);
      return { meta: null };
    }
  }
  return { meta: null };
});

builder.defineStreamHandler(async ({ type, id, extra }) => {
  console.log('Stream requested:', { type, id, extra });

  // Extraer configId y channelId desde el ID
  const parts = id.split('_');
  const configId = parts[1];
  const channelId = parts.slice(2).join('_');
  const m3uUrl = await getM3uUrlFromConfigId(configId);
  console.log('Stream configId:', configId, 'm3uUrl:', m3uUrl || 'none');

  if (type === 'tv') {
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
      return response;
    } catch (error) {
      console.error('Stream error:', error.message, error.stack);
      return { streams: [] };
    }
  }

  return { streams: [] };
});
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

// Añadir CORS para permitir solicitudes desde Stremio
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
  } else {
    next();
  }
});

// Manifest estático
router.get('/manifest.json', async (req, res) => {
  const configId = req.query.configId || 'none';
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

// Catalog sin configId en el path
router.get('/catalog/:type/:id.json', (req, res) => {
  const id = req.params.id.replace(/\.json$/, '');
  const configId = id.startsWith('Heimdallr_') ? id.split('_')[1] : 'none';
  const extra = { configId, ...req.query };
  addonInterface.catalog({ type: req.params.type, id, extra }, res);
});

// Meta sin configId en el path
router.get('/meta/:type/:id.json', (req, res) => {
  const id = req.params.id.replace(/\.json$/, '');
  const configId = id.startsWith('Heimdallr_') ? id.split('_')[1] : 'none';
  const extra = { configId, ...req.query };
  addonInterface.meta({ type: req.params.type, id, extra }, res);
});

// Stream sin configId en el path
router.get('/stream/:type/:id.json', (req, res) => {
  const id = req.params.id.replace(/\.json$/, '');
  const configId = id.startsWith('Heimdallr_') ? id.split('_')[1] : 'none';
  const extra = { configId, ...req.query };
  addonInterface.stream({ type: req.params.type, id, extra }, res);
});


// Meta sin configId en el path
router.get('/meta/:type/:id.json', (req, res) => {
  const id = req.params.id.replace(/\.json$/, '');
  const configId = id.startsWith('Heimdallr_') ? id.split('_')[1] : 'none';
  const extra = { configId, ...req.query };
  addonInterface.meta({ type: req.params.type, id, extra }, res);
});

// Stream sin configId en el path
router.get('/stream/:type/:id.json', (req, res) => {
  const id = req.params.id.replace(/\.json$/, '');
  const configId = id.startsWith('Heimdallr_') ? id.split('_')[1] : 'none';
  const extra = { configId, ...req.query };
  addonInterface.stream({ type: req.params.type, id, extra }, res);
});

// Meta routes
router.get('/:configId/meta/:type/:id', (req, res) => {
  const extra = { configId: req.params.configId, ...req.query };
  addonInterface.meta({ type: req.params.type, id: req.params.id.replace(/\.json$/, ''), extra }, res);
});

router.get('/:configId/meta/:type/:id.json', (req, res) => {
  const extra = { configId: req.params.configId, ...req.query };
  addonInterface.meta({ type: req.params.type, id: req.params.id.replace(/\.json$/, ''), extra }, res);
});

// Stream routes
router.get('/:configId/stream/:type/:id', (req, res) => {
  const extra = { configId: req.params.configId, ...req.query };
  addonInterface.stream({ type: req.params.type, id: req.params.id.replace(/\.json$/, ''), extra }, res);
});

router.get('/:configId/stream/:type/:id.json', (req, res) => {
  const extra = { configId: req.params.configId, ...req.query };
  addonInterface.stream({ type: req.params.type, id: req.params.id.replace(/\.json$/, ''), extra }, res);
});

// Configure route
router.get('/configure', (req, res) => {
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

// Generate URL route
router.post('/generate-url', async (req, res) => {
  try {
    const m3uUrl = req.body.m3uUrl;
    const isValid = await validateM3uUrl(m3uUrl);
    if (!isValid) throw new Error('Invalid M3U URL');

    const configId = uuidv4();
    await setM3uUrlInConfigId(configId, m3uUrl);
    const baseUrl = `https://${req.headers.host}/${configId}/manifest.json`;
    const installUrl = `stremio://${encodeURIComponent(baseUrl)}`;
    const manifestJson = JSON.stringify(baseManifest, null, 2);

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
  const urlParts = req.url.split('/');
  let configId = req.params.configId || urlParts[1];
  if (['configure', 'generate-url', ''].includes(urlParts[1])) configId = null;
  req.configId = configId;
  req.extra = req.extra || {};
  req.extra.configId = req.configId;
  next();
});

if (process.env.NODE_ENV !== 'production') {
  const { serveHTTP } = require('stremio-addon-sdk');
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

module.exports = (req, res) => {
  router(req, res, () => {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Route not found' }));
  });
};
