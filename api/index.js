const express = require('express');
const { addonBuilder } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel } = require('../src/db');
const { CACHE_TTL } = require('../src/config');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fetch = require('node-fetch');
require('dotenv').config();

const cache = new NodeCache({ stdTTL: CACHE_TTL });

const baseManifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.191',
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

// KV: Obtener y guardar m3uUrl
async function getM3uUrlFromConfigId(configId) {
  if (!configId || configId === 'none') return null;
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_KV_API_TOKEN}` }
      }
    );
    return response.ok ? await response.text() : null;
  } catch (err) {
    console.error('KV fetch error:', err.message);
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
          'Content-Type': 'text/plain'
        },
        body: m3uUrl
      }
    );
    if (!response.ok) throw new Error(`KV store failed: ${response.status}`);
  } catch (err) {
    console.error('KV store error:', err.message);
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
    console.error('M3U validation error:', err.message);
    return false;
  }
}
// Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const configId = id.startsWith('Heimdallr_') ? id.split('_')[1] : 'none';
  const m3uUrl = await getM3uUrlFromConfigId(configId);
  if (!m3uUrl) return { metas: [] };

  const m3uHash = crypto.createHash('md5').update(m3uUrl).digest('hex');
  const cacheKey = `catalog_${m3uHash}_${extra?.genre || ''}_${extra?.search || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channels = await getChannels({ m3uUrl });
    let filtered = channels;

    if (extra?.search) {
      const query = extra.search.toLowerCase();
      filtered = filtered.filter(c => c.name.toLowerCase().includes(query));
    }

    if (extra?.genre) {
      filtered = filtered.filter(c =>
        c.group_title === extra.genre ||
        c.extra_genres?.includes(extra.genre) ||
        c.additional_streams?.some(s => s.group_title === extra.genre)
      );
    }

    const metas = filtered.map(c => ({
      id: `heimdallr_${configId}_${c.id}`,
      type: 'tv',
      name: c.name,
      poster: c.logo_url
    }));

    const response = { metas };
    cache.set(cacheKey, response);
    return response;
  } catch (err) {
    console.error('Catalog error:', err.message);
    return { metas: [] };
  }
});

// Meta handler
builder.defineMetaHandler(async ({ type, id, extra }) => {
  const parts = id.split('_');
  const configId = parts[1];
  const channelId = parts.slice(2).join('_');
  const m3uUrl = await getM3uUrlFromConfigId(configId);
  if (!m3uUrl) return { meta: null };

  const m3uHash = crypto.createHash('md5').update(m3uUrl).digest('hex');
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

// Stream handler
builder.defineStreamHandler(async ({ type, id, extra }) => {
  const parts = id.split('_');
  const configId = parts[1];
  const channelId = parts.slice(2).join('_');
  const m3uUrl = await getM3uUrlFromConfigId(configId);
  if (!m3uUrl) return { streams: [] };

  const m3uHash = crypto.createHash('md5').update(m3uUrl).digest('hex');
  const cacheKey = `stream_${m3uHash}_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channel = await getChannel(channelId, { m3uUrl });
    const streams = [];

    const addStream = (source) => {
      const streamObj = {
        name: source.group_title,
        title: source.title
      };
      if (source.acestream_id) {
        streamObj.externalUrl = `acestream://${source.acestream_id}`;
        streamObj.behaviorHints = { notWebReady: true, external: true };
      } else if (source.m3u8_url || source.stream_url || source.url) {
        streamObj.url = source.m3u8_url || source.stream_url || source.url;
        streamObj.behaviorHints = { notWebReady: false, external: false };
      }
      streams.push(streamObj);
    };

    if (channel.acestream_id || channel.m3u8_url || channel.stream_url) {
      addStream(channel);
    }

    (channel.additional_streams || []).forEach(addStream);

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
  } catch (err) {
    console.error('Stream error:', err.message);
    return { streams: [] };
  }
});
const router = express.Router();
const addonInterface = builder.getInterface();

// CORS
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

// Manifest dinámico
router.get('/:configId/manifest.json', async (req, res) => {
  const configId = req.params.configId || 'none';
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

// Rutas para Stremio con configId en el path
router.get('/:configId/catalog/:type/:id.json', (req, res) => {
  const id = req.params.id.replace(/\.json$/, '');
  const configId = req.params.configId;
  const extra = { configId, ...req.query };
  addonInterface.catalog({ type: req.params.type, id, extra }, res);
});

router.get('/:configId/meta/:type/:id.json', (req, res) => {
  const id = req.params.id.replace(/\.json$/, '');
  const configId = req.params.configId;
  const extra = { configId, ...req.query };
  addonInterface.meta({ type: req.params.type, id, extra }, res);
});

router.get('/:configId/stream/:type/:id.json', (req, res) => {
  const id = req.params.id.replace(/\.json$/, '');
  const configId = req.params.configId;
  const extra = { configId, ...req.query };
  addonInterface.stream({ type: req.params.type, id, extra }, res);
});

// Página de configuración
router.get('/configure', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <html>
      <head><title>Configure Heimdallr</title></head>
      <body>
        <h1>Configura tu lista M3U</h1>
        <form action="/generate-url" method="post">
          <input type="text" name="m3uUrl" placeholder="https://example.com/list.m3u" required style="width:100%;padding:10px;">
          <button type="submit" style="padding:10px 20px;">Generar URL</button>
        </form>
      </body>
    </html>
  `);
});

// Generar URL de instalación
router.post('/generate-url', bodyParser.urlencoded({ extended: false }), async (req, res) => {
  try {
    const m3uUrl = req.body.m3uUrl;
    const isValid = await validateM3uUrl(m3uUrl);
    if (!isValid) throw new Error('Invalid M3U URL');

    const configId = uuidv4();
    await setM3uUrlInConfigId(configId, m3uUrl);
    const baseUrl = `https://${req.headers.host}/${configId}/manifest.json`;
    const installUrl = `stremio://${encodeURIComponent(baseUrl)}`;

    res.setHeader('Content-Type', 'text/html');
    res.end(`
      <html>
        <body>
          <h1>Addon generado</h1>
          <p>Instala el addon en Stremio:</p>
          <a href="${installUrl}" style="padding:10px 20px;background:#4CAF50;color:white;border-radius:5px;">Instalar</a>
          <p>O copia esta URL:</p>
          <pre>${baseUrl}</pre>
        </body>
      </html>
    `);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><body><h1>Error</h1><p>${err.message}</p></body></html>`);
  }
});

module.exports = router;
