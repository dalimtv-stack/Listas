// index.js (parcheado) - versión completa
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT } = require('./src/config');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fetch = require('node-fetch');
require('dotenv').config();

const cache = new NodeCache({ stdTTL: CACHE_TTL || 300 });

const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.180',
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
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

// --- Utilities for Cloudflare KV storage (configId -> m3uUrl)
async function getM3uUrlFromConfigId(configId) {
  if (!configId || configId === 'none') {
    console.log('getM3uUrlFromConfigId: no configId provided, returning null');
    return null;
  }
  if (!process.env.CLOUDFLARE_KV_ACCOUNT_ID || !process.env.CLOUDFLARE_KV_NAMESPACE_ID || !process.env.CLOUDFLARE_KV_API_TOKEN) {
    console.warn('Cloudflare KV env vars missing; cannot fetch m3uUrl from KV');
    return null;
  }
  try {
    console.log('Fetching m3uUrl from Cloudflare KV for configId:', configId);
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_KV_API_TOKEN}` }
      }
    );
    const text = await resp.text();
    if (!resp.ok) {
      console.error('Cloudflare KV GET failed:', resp.status, resp.statusText, text);
      return null;
    }
    console.log('Retrieved m3uUrl from KV:', text);
    return text;
  } catch (err) {
    console.error('Error in getM3uUrlFromConfigId:', err.message);
    return null;
  }
}

async function setM3uUrlInConfigId(configId, m3uUrl) {
  if (!process.env.CLOUDFLARE_KV_ACCOUNT_ID || !process.env.CLOUDFLARE_KV_NAMESPACE_ID || !process.env.CLOUDFLARE_KV_API_TOKEN) {
    throw new Error('Cloudflare KV env vars missing; cannot save config');
  }
  try {
    console.log('Storing m3uUrl in Cloudflare KV:', { configId, m3uUrl });
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_KV_API_TOKEN}`,
          'Content-Type': 'text/plain'
        },
        body: m3uUrl
      }
    );
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`Cloudflare KV PUT failed: ${resp.status} ${resp.statusText} - ${text}`);
    }
    console.log('Successfully stored m3uUrl in KV for configId:', configId);
  } catch (err) {
    console.error('Error in setM3uUrlInConfigId:', err.message);
    throw err;
  }
}

async function validateM3uUrl(m3uUrl) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(m3uUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    console.log('Validated M3U URL:', m3uUrl, 'Status:', res.status);
    return res.ok;
  } catch (err) {
    console.error('validateM3uUrl error:', err.message);
    return false;
  }
}

// --- Middlewares ---
// CORS + preflight
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  next();
});

// body parser for form submissions
router.use(bodyParser.urlencoded({ extended: false }));

// Extract configId from path (first path segment) and attach to req.extra
router.use((req, res, next) => {
  try {
    const path = (req.path || req.url || '').split('?')[0];
    const parts = path.split('/').filter(Boolean);
    let configId = null;
    if (parts.length > 0 && !['configure', 'generate-url', 'manifest.json', 'favicon.ico'].includes(parts[0])) {
      configId = parts[0];
    }
    req.configId = configId;
    req.extra = req.extra || {};
    req.extra.configId = configId;
    // log minimal info for debugging
    console.log('Middleware extracted configId:', req.configId || 'none', 'path:', path);
  } catch (err) {
    console.error('Error extracting configId:', err.message);
  }
  next();
});

// --- Handlers defined via addonBuilder ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  console.log('Catalog requested by addon system:', { type, id, extra });
  const configId = extra?.configId || 'none';
  const m3uUrl = await getM3uUrlFromConfigId(configId);
  if (type === 'tv' && id === 'Heimdallr') {
    const m3uHash = m3uUrl ? crypto.createHash('md5').update(m3uUrl).digest('hex') : 'default';
    const cacheKey = `Heimdallr_channels_${m3uHash}_${extra?.genre || ''}_${extra?.search || ''}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('Returning cached catalog');
      return cached;
    }
    try {
      const channels = await getChannels({ m3uUrl });
      console.log('Fetched channels count:', channels.length);
      let filteredChannels = channels;
      if (extra?.search) {
        const q = extra.search.toLowerCase();
        filteredChannels = filteredChannels.filter(c => (c.name || '').toLowerCase().includes(q));
      }
      if (extra?.genre) {
        const genreQ = extra.genre.toLowerCase();
        filteredChannels = filteredChannels.filter(channel => {
          if ((channel.group_title || '').toLowerCase() === genreQ) return true;
          if (channel.additional_streams && Array.isArray(channel.additional_streams)) {
            if (channel.additional_streams.some(s => (s.group_title || '').toLowerCase() === genreQ)) return true;
          }
          if (channel.extra_genres && Array.isArray(channel.extra_genres)) {
            if (channel.extra_genres.map(g => g.toLowerCase()).includes(genreQ)) return true;
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
      console.log('Catalog response metas count:', metas.length);
      return response;
    } catch (err) {
      console.error('Catalog handler error:', err.message);
      return { metas: [] };
    }
  }
  return { metas: [] };
});

builder.defineMetaHandler(async ({ type, id, extra }) => {
  console.log('Meta requested:', { type, id, extra });
  const configId = extra?.configId || 'none';
  const m3uUrl = await getM3uUrlFromConfigId(configId);
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
      console.error('Meta handler error:', err.message);
      return { meta: null };
    }
  }
  return { meta: null };
});

builder.defineStreamHandler(async ({ type, id, extra }) => {
  console.log('Stream requested:', { type, id, extra });
  const configId = extra?.configId || 'none';
  const m3uUrl = await getM3uUrlFromConfigId(configId);
  if (type === 'tv' && id.startsWith('heimdallr_')) {
    const channelId = id.replace('heimdallr_', '');
    const m3uHash = m3uUrl ? crypto.createHash('md5').update(m3uUrl).digest('hex') : 'default';
    const cacheKey = `stream_${m3uHash}_${channelId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    try {
      const channel = await getChannel(channelId, { m3uUrl });
      const streams = [];
      // primary stream
      if (channel.acestream_id || channel.m3u8_url || channel.stream_url) {
        const primary = {
          name: channel.additional_streams && channel.additional_streams.length > 0 ? channel.additional_streams[0].group_title : channel.group_title,
          title: channel.title
        };
        if (channel.acestream_id) {
          primary.externalUrl = `acestream://${channel.acestream_id}`;
          primary.behaviorHints = { notWebReady: true, external: true };
        } else if (channel.m3u8_url) {
          primary.url = channel.m3u8_url;
          primary.behaviorHints = { notWebReady: false, external: false };
        } else if (channel.stream_url) {
          primary.url = channel.stream_url;
          primary.behaviorHints = { notWebReady: false, external: false };
        }
        streams.push(primary);
      }
      // additional streams
      if (channel.additional_streams && Array.isArray(channel.additional_streams)) {
        channel.additional_streams.forEach(s => {
          const obj = { name: s.group_title, title: s.title };
          if (s.acestream_id) {
            obj.externalUrl = `acestream://${s.acestream_id}`;
            obj.behaviorHints = { notWebReady: true, external: true };
          } else if (s.url) {
            obj.url = s.url;
            obj.behaviorHints = { notWebReady: false, external: false };
          } else if (s.stream_url) {
            obj.url = s.stream_url;
            obj.behaviorHints = { notWebReady: false, external: false };
          }
          streams.push(obj);
        });
      }
      // website fallback
      if (channel.website_url) {
        streams.push({ title: `${channel.name} - Website`, externalUrl: channel.website_url, behaviorHints: { notWebReady: true, external: true } });
      }
      const response = { streams };
      cache.set(cacheKey, response);
      console.log('Streams generated count:', streams.length);
      return response;
    } catch (err) {
      console.error('Stream handler error:', err.message);
      return { streams: [] };
    }
  }
  return { streams: [] };
});

// --- HTTP routes ---
// Manifest routes
router.get('/manifest.json', async (req, res) => {
  console.log('Static manifest requested, path:', req.path);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(manifest));
});

router.get('/:configId/manifest.json', async (req, res) => {
  console.log('Dynamic manifest requested for configId:', req.params.configId);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(manifest));
});

// Catalog routes (for Stremio to call)
router.get('/:configId/catalog/:type/:id', (req, res) => {
  console.log('HTTP catalog route:', req.params.configId, req.params.type, req.params.id);
  const extra = { configId: req.params.configId, ...req.query };
  addonInterface.catalog({ type: req.params.type, id: req.params.id.replace(/\.json$/, ''), extra }, res);
});
router.get('/:configId/catalog/:type/:id.json', (req, res) => {
  const extra = { configId: req.params.configId, ...req.query };
  addonInterface.catalog({ type: req.params.type, id: req.params.id.replace(/\.json$/, ''), extra }, res);
});
router.get('/:configId/catalog.json', (req, res) => {
  const extra = { configId: req.params.configId, ...req.query };
  addonInterface.catalog({ type: 'tv', id: 'Heimdallr', extra }, res);
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

// Configure UI
router.get('/configure', (req, res) => {
  console.log('Serving /configure');
  res.setHeader('Content-Type', 'text/html');
  res.end(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Configure Heimdallr Channels</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:20px auto;padding:10px}
      input{width:100%;padding:10px;margin:10px 0}
      button{background:#4CAF50;color:#fff;padding:10px 16px;border:0;border-radius:6px;cursor:pointer}
      pre{background:#f4f4f4;padding:10px;border-radius:6px;overflow:auto}
      .muted{color:#666;font-size:0.9rem}
    </style>
  </head>
  <body>
    <h1>Heimdallr - Configure</h1>
    <p>Introduce la URL de tu lista M3U pública (HTTP/HTTPS):</p>
    <form action="/generate-url" method="post">
      <input type="url" name="m3uUrl" placeholder="https://example.com/list.m3u" required />
      <button type="submit">Generar URL de instalación</button>
    </form>
    <p class="muted">La URL se almacenará en Cloudflare KV y se generará un <code>configId</code> que enlazará esa lista con el manifest.</p>
  </body>
</html>
  `);
});

// Generate install URL
router.post('/generate-url', async (req, res) => {
  console.log('POST /generate-url body:', req.body);
  try {
    if (!req.body || !req.body.m3uUrl) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/html');
      return res.end('<html><body><h1>Error</h1><p>M3U URL required. <a href="/configure">Back</a></p></body></html>');
    }
    const m3uUrl = req.body.m3uUrl.trim();
    if (!m3uUrl) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/html');
      return res.end('<html><body><h1>Error</h1><p>M3U URL empty. <a href="/configure">Back</a></p></body></html>');
    }
    const valid = await validateM3uUrl(m3uUrl);
    if (!valid) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/html');
      return res.end(`<html><body><h1>Error</h1><p>Invalid or inaccessible M3U URL: ${m3uUrl}. <a href="/configure">Back</a></p></body></html>`);
    }
    const configId = uuidv4();
    await setM3uUrlInConfigId(configId, m3uUrl);
    const host = req.headers.host || 'localhost';
    const baseUrl = `https://${host}/${configId}/manifest.json`;
    const installUrl = `stremio://${encodeURIComponent(baseUrl)}`;

    res.setHeader('Content-Type', 'text/html');
    res.end(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Install Heimdallr</title>
    <style>body{font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:20px auto}button{background:#4CAF50;color:#fff;padding:8px 12px;border:0;border-radius:6px;cursor:pointer}pre{background:#f4f4f4;padding:10px;border-radius:6px}</style>
    <script>
      function copyText() { navigator.clipboard.writeText(document.getElementById('manifest').textContent).then(()=>alert('Copied'))}
    </script>
  </head>
  <body>
    <h1>Install URL Generated</h1>
    <p>Instala el addon en Stremio usando el siguiente enlace (desde el dispositivo con Stremio):</p>
    <p><a href="${installUrl}" style="display:inline-block;padding:8px 12px;background:#4CAF50;color:#fff;border-radius:6px;text-decoration:none">Instalar Addon</a></p>
    <p>Manifest URL (usa esta si necesitas copiar la URL):</p>
    <pre id="manifest">${baseUrl}</pre>
    <p><button onclick="copyText()">Copiar Manifest URL</button></p>
    <h3>Manifest (preview)</h3>
    <pre>${JSON.stringify(manifest, null, 2)}</pre>
  </body>
</html>
    `);
  } catch (err) {
    console.error('Error in /generate-url:', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><body><h1>Server Error</h1><p>${err.message}</p><p><a href="/configure">Back</a></p></body></html>`);
  }
});

// Fallback handler for other routes
module.exports = (req, res) => {
  try {
    console.log('Main handler - incoming request:', req.url, 'configId:', req.configId || 'none');
    router(req, res, () => {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Route not found' }));
    });
  } catch (err) {
    console.error('Main handler error:', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Internal Server Error', details: err.message }));
  }
};
