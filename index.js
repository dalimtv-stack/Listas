// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT } = require('./src/config');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fetch = require('node-fetch');
require('dotenv').config();

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Manifest del addon
const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.166',
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
        { name: 'genre', isRequired: false, options: ['Adultos','Elcano.top','Hulu.to','NEW LOOP','Noticias','Shickat.me','Telegram','Deportes','Movistar'] }
      ]
    }
  ],
  resources: ['catalog','meta','stream'],
  idPrefixes: ['heimdallr_'],
  behaviorHints: { configurable: true }
};

const builder = new addonBuilder(manifest);

// Funciones de configuración KV
async function getM3uUrlFromConfigId(configId) {
  if (!configId || configId === 'none') return null;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`,
      { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_KV_API_TOKEN}` } }
    );
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function setM3uUrlInConfigId(configId, m3uUrl) {
  try {
    await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_KV_API_TOKEN}`, 'Content-Type': 'text/plain' },
        body: m3uUrl
      }
    );
  } catch (err) { console.error(err); }
}

async function validateM3uUrl(m3uUrl) {
  try {
    const res = await fetch(m3uUrl, { method: 'HEAD' });
    return res.ok;
  } catch (err) { return false; }
}

// Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const configId = extra?.configId || 'none';
  const m3uUrl = await getM3uUrlFromConfigId(configId) || null;
  if (type !== 'tv' || id !== 'Heimdallr') return { metas: [] };

  const m3uHash = m3uUrl ? crypto.createHash('md5').update(m3uUrl).digest('hex') : 'default';
  const cacheKey = `Heimdallr_channels_${m3uHash}_${extra?.genre||''}_${extra?.search||''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const channels = await getChannels({ m3uUrl });
  let filtered = channels;

  if (extra?.search) filtered = filtered.filter(c => c.name.toLowerCase().includes(extra.search.toLowerCase()));
  if (extra?.genre) filtered = filtered.filter(c =>
    c.group_title === extra.genre ||
    c.extra_genres.includes(extra.genre) ||
    c.additional_streams.some(s => s.group_title === extra.genre)
  );

  const metas = filtered.map(c => ({ id: `heimdallr_${c.id}`, type: 'tv', name: c.name, poster: c.logo_url }));
  const response = { metas };
  cache.set(cacheKey, response);
  return response;
});

// Meta handler
builder.defineMetaHandler(async ({ type, id, extra }) => {
  if (type !== 'tv' || !id.startsWith('heimdallr_')) return { meta: null };
  const channelId = id.replace('heimdallr_', '');
  const m3uUrl = await getM3uUrlFromConfigId(extra?.configId) || null;

  const channel = await getChannel(channelId, { m3uUrl });
  return {
    meta: {
      id,
      type: 'tv',
      name: channel.name,
      poster: channel.logo_url,
      background: channel.logo_url,
      description: channel.name
    }
  };
});

// Stream handler
builder.defineStreamHandler(async ({ type, id, extra }) => {
  if (type !== 'tv' || !id.startsWith('heimdallr_')) return { streams: [] };
  const channelId = id.replace('heimdallr_', '');
  const m3uUrl = await getM3uUrlFromConfigId(extra?.configId) || null;
  const channel = await getChannel(channelId, { m3uUrl });

  const streams = channel.additional_streams.map(stream => {
    const obj = { name: stream.group_title, title: stream.title };
    if (stream.acestream_id) obj.externalUrl = `acestream://${stream.acestream_id}`;
    else obj.url = stream.url || stream.stream_url;
    obj.behaviorHints = { notWebReady: !!stream.acestream_id, external: !!stream.acestream_id };
    return obj;
  });
  return { streams };
});

// Router
const router = getRouter(builder.getInterface());

// Página de configuración
router.use(bodyParser.urlencoded({ extended: false }));
router.get('/configure', (req,res) => {
  res.setHeader('Content-Type','text/html');
  res.end(`<html><body><h1>Configure Heimdallr</h1>
  <form action="/generate-url" method="post">
  <input type="text" name="m3uUrl" placeholder="https://example.com/list.m3u" required>
  <button type="submit">Generate Install URL</button></form></body></html>`);
});

router.post('/generate-url', async (req,res) => {
  const m3uUrl = req.body?.m3uUrl;
  if (!m3uUrl || !(await validateM3uUrl(m3uUrl))) return res.status(400).send('Invalid M3U URL');

  const configId = uuidv4();
  await setM3uUrlInConfigId(configId, m3uUrl);
  const baseUrl = `https://${req.headers.host}/${configId}/manifest.json`;
  const installUrl = `stremio://${encodeURIComponent(baseUrl)}`;

  res.setHeader('Content-Type','text/html');
  res.end(`<p>Install URL: <a href="${installUrl}">${installUrl}</a></p>`);
});

// Servidor local para desarrollo
if (process.env.NODE_ENV !== 'production') {
  const { serveHTTP } = require('stremio-addon-sdk');
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

module.exports = (req,res) => router(req,res,()=>{res.statusCode=404;res.end('Route not found')});
