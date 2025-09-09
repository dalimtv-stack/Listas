// index.js
const { addonBuilder, getRouter, serveHTTP } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel, loadM3U } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT } = require('./src/config');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fetch = require('node-fetch');
require('dotenv').config();

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// ---------------- Manifest ----------------
const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.170',
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
  behaviorHints: { configurable: true }
};

const builder = new addonBuilder(manifest);

// ---------------- Helpers ----------------
async function getM3uUrlFromConfigId(configId) {
  if (!configId || configId === 'none') return null;
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`,
      { method: 'GET', headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_KV_API_TOKEN}` } }
    );
    if (!response.ok) return null;
    return await response.text();
  } catch (err) {
    console.error('Error getM3uUrlFromConfigId:', err.message);
    return null;
  }
}

async function setM3uUrlInConfigId(configId, m3uUrl) {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_KV_API_TOKEN}`,
          'Content-Type': 'text/plain',
        },
        body: m3uUrl
      }
    );
    if (!response.ok) throw new Error(`Failed to store M3U in KV: ${response.status}`);
  } catch (err) {
    console.error('Error setM3uUrlInConfigId:', err.message);
    throw err;
  }
}

async function validateM3uUrl(m3uUrl) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(m3uUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok;
  } catch (err) {
    console.error('Invalid M3U URL:', err.message);
    return false;
  }
}

// ---------------- Catalog Handler ----------------
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const configId = extra?.configId || 'none';
  const m3uUrl = await getM3uUrlFromConfigId(configId);
  if (type !== 'tv' || id !== 'Heimdallr') return { metas: [] };

  const m3uHash = m3uUrl ? crypto.createHash('md5').update(m3uUrl).digest('hex') : 'default';
  const cacheKey = `catalog_${m3uHash}_${extra?.genre || ''}_${extra?.search || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channels = await getChannels({ m3uUrl });
    let filteredChannels = channels;
    if (extra?.search) filteredChannels = filteredChannels.filter(c => c.name.toLowerCase().includes(extra.search.toLowerCase()));
    if (extra?.genre) {
      filteredChannels = filteredChannels.filter(c =>
        c.group_title === extra.genre ||
        (c.additional_streams?.some(s => s.group_title === extra.genre)) ||
        (c.extra_genres?.includes(extra.genre))
      );
    }
    const metas = filteredChannels.map(channel => ({
      id: `heimdallr_${channel.id}`,
      type: 'tv',
      name: channel.name,
      poster: channel.logo_url
    }));
    const response = { metas };
    cache.set(cacheKey, response);
    return response;
  } catch (err) {
    console.error('Catalog error:', err.message);
    return { metas: [] };
  }
});

// ---------------- Meta Handler ----------------
builder.defineMetaHandler(async ({ type, id, extra }) => {
  if (type !== 'tv' || !id.startsWith('heimdallr_')) return { meta: null };
  const configId = extra?.configId || 'none';
  const m3uUrl = await getM3uUrlFromConfigId(configId);
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
    console.error('Meta error:', err.message);
    return { meta: null };
  }
});

// ---------------- Stream Handler ----------------
builder.defineStreamHandler(async ({ type, id, extra }) => {
  if (type !== 'tv' || !id.startsWith('heimdallr_')) return { streams: [] };
  const configId = extra?.configId || 'none';
  const m3uUrl = await getM3uUrlFromConfigId(configId);
  const channelId = id.replace('heimdallr_', '');
  const m3uHash = m3uUrl ? crypto.createHash('md5').update(m3uUrl).digest('hex') : 'default';
  const cacheKey = `stream_${m3uHash}_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channel = await getChannel(channelId, { m3uUrl });
    const streams = [];

    function pushStream(s) {
      const obj = { name: s.group_title || channel.group_title, title: s.title || channel.name };
      if (s.acestream_id) obj.externalUrl = `acestream://${s.acestream_id}`, obj.behaviorHints = { notWebReady: true, external: true };
      else if (s.m3u8_url) obj.url = s.m3u8_url, obj.behaviorHints = { notWebReady: false, external: false };
      else if (s.stream_url) obj.url = s.stream_url, obj.behaviorHints = { notWebReady: false, external: false };
      streams.push(obj);
    }

    if (channel.acestream_id || channel.m3u8_url || channel.stream_url) pushStream(channel);
    if (Array.isArray(channel.additional_streams)) channel.additional_streams.forEach(pushStream);
    if (channel.website_url) streams.push({ title: `${channel.name} - Website`, externalUrl: channel.website_url, behaviorHints: { notWebReady: true, external: true } });

    const response = { streams };
    cache.set(cacheKey, response);
    return response;
  } catch (err) {
    console.error('Stream error:', err.message);
    return { streams: [] };
  }
});

// ---------------- Router ----------------
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

// Middleware para extraer configId
router.use(bodyParser.urlencoded({ extended: false }));
router.use((req, res, next) => {
  const match = req.url.match(/^\/([^/]+)(\/.*)?$/);
  req.configId = match ? match[1] : null;
  req.extra = req.extra || {};
  req.extra.configId = req.configId;
  next();
});

// Manifest routes
router.get(['/manifest.json', '/:configId/manifest.json'], async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(manifest));
});

// Catalog / Meta / Stream dynamic routes
router.get(['/:configId/catalog.json', '/:configId/catalog/:type/:id.json'], (req, res) => {
  const extra = { configId: req.configId, ...req.query };
  const cleanId = req.params.id?.replace(/\.json$/, '') || 'Heimdallr';
  addonInterface.catalog({ ...req, type: 'tv', id: cleanId, extra }, res);
});
router.get(['/:configId/meta/:type/:id.json'], (req, res) => {
  const extra = { configId: req.configId, ...req.query };
  const cleanId = req.params.id.replace(/\.json$/, '');
  addonInterface.meta({ ...req, type: req.params.type, id: cleanId, extra }, res);
});
router.get(['/:configId/stream/:type/:id.json'], (req, res) => {
  const extra = { configId: req.configId, ...req.query };
  const cleanId = req.params.id.replace(/\.json$/, '');
  addonInterface.stream({ ...req, type: req.params.type, id: cleanId, extra }, res);
});

// Configure / Generate URL
router.get('/configure', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <!DOCTYPE html><html><head><title>Configure Heimdallr Channels</title></head>
    <body><form action="/generate-url" method="post">
      <input type="text" name="m3uUrl" required>
      <button type="submit">Generate Install URL</button>
    </form></body></html>
  `);
});

router.post('/generate-url', async (req, res) => {
  const m3uUrl = req.body?.m3uUrl;
  if (!m3uUrl) return res.status(400).send('M3U URL required');

  if (!(await validateM3uUrl(m3uUrl))) return res.status(400).send('Invalid M3U URL');

  const configId = uuidv4();
  await setM3uUrlInConfigId(configId, m3uUrl);
  const baseUrl = `https://${req.headers.host}/${configId}/manifest.json`;
  res.send(`Install URL: stremio://${encodeURIComponent(baseUrl)}`);
});

// ---------------- Server ----------------
if (process.env.NODE_ENV !== 'production') serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });

// Export Lambda/Serverless handler
module.exports = (req, res) => {
  router(req, res, () => res.status(404).json({ error: 'Route not found' }));
};
