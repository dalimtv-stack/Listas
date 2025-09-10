// api/index.js COPILOT
'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const NodeCache = require('node-cache');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
require('dotenv').config();

const { getChannels, getChannel } = require('../src/db');

const app = express();
const router = express.Router();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const CACHE_TTL = parseInt(process.env.CACHE_TTL || '300', 10);
const cache = new NodeCache({ stdTTL: CACHE_TTL });

const BASE_ADDON_ID = 'org.stremio.Heimdallr';
const ADDON_NAME = 'Heimdallr Channels';
const ADDON_PREFIX = 'heimdallr';
const CATALOG_PREFIX = 'Heimdallr';
const DEFAULT_CONFIG_ID = 'default';
const DEFAULT_M3U_URL = process.env.DEFAULT_M3U_URL || '';

// CORS
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// KV helpers
async function kvGet(configId) {
  if (!configId) return null;
  try {
    const { CLOUDFLARE_KV_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID, CLOUDFLARE_KV_API_TOKEN } = process.env;
    if (!CLOUDFLARE_KV_ACCOUNT_ID || !CLOUDFLARE_KV_NAMESPACE_ID || !CLOUDFLARE_KV_API_TOKEN) return null;
    const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${CLOUDFLARE_KV_API_TOKEN}` } });
    return r.ok ? await r.text() : null;
  } catch (e) {
    console.error('KV get error:', e.message);
    return null;
  }
}

async function kvSet(configId, value) {
  const { CLOUDFLARE_KV_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID, CLOUDFLARE_KV_API_TOKEN } = process.env;
  if (!CLOUDFLARE_KV_ACCOUNT_ID || !CLOUDFLARE_KV_NAMESPACE_ID || !CLOUDFLARE_KV_API_TOKEN) {
    throw new Error('Cloudflare KV no configurado');
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CLOUDFLARE_KV_API_TOKEN}`, 'Content-Type': 'text/plain' },
    body: value
  });
  if (!r.ok) throw new Error(`KV set failed: ${r.status}`);
}

// Utils
function buildManifest(configId) {
  return {
    id: BASE_ADDON_ID,
    version: '1.3.2',
    name: ADDON_NAME,
    description: 'Carga canales Acestream o M3U8 desde lista M3U (KV o por defecto).',
    types: ['tv'],
    logo: 'https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960',
    resources: ['catalog', 'meta', 'stream'],
    idPrefixes: [`${ADDON_PREFIX}_`],
    behaviorHints: { configurable: true },
    catalogs: [
      {
        type: 'tv',
        id: `${CATALOG_PREFIX}_${configId}`,
        name: 'Heimdallr Live Channels',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'genre', isRequired: false, options: ['Noticias', 'Deportes', 'Telegram', 'Movistar', 'Adultos'] }
        ]
      }
    ]
  };
}

async function resolveM3uUrl(configId) {
  const kv = await kvGet(configId);
  if (kv) return kv;
  if (DEFAULT_M3U_URL) return DEFAULT_M3U_URL;
  return null;
}

function extractConfigIdFromUrl(req) {
  const m = req.url.match(/^\/([^/]+)\/(manifest\.json|catalog|meta|stream)\b/);
  if (m && m[1]) return m[1];
  return DEFAULT_CONFIG_ID;
}

// Core handlers
async function handleCatalog({ type, id, extra, m3uUrl }) {
  if (type !== 'tv' || !m3uUrl) return { metas: [] };

  const m3uHash = crypto.createHash('md5').update(m3uUrl).digest('hex');
  const cacheKey = `catalog_${m3uHash}_${extra?.genre || ''}_${extra?.search || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const channels = await getChannels({ m3uUrl });
  let filtered = channels;

  if (extra.search) {
    const q = String(extra.search).toLowerCase();
    filtered = filtered.filter(c => c.name?.toLowerCase().includes(q));
  }
  if (extra.genre) {
    const g = String(extra.genre);
    filtered = filtered.filter(c =>
      c.group_title === g ||
      (Array.isArray(c.extra_genres) && c.extra_genres.includes(g)) ||
      (Array.isArray(c.additional_streams) && c.additional_streams.some(s => s.group_title === g))
    );
  }

  const configId = (id.startsWith(`${CATALOG_PREFIX}_`) ? id.split('_')[1] : DEFAULT_CONFIG_ID) || DEFAULT_CONFIG_ID;

  const metas = filtered.map(c => ({
    id: `${ADDON_PREFIX}_${configId}_${c.id}`,
    type: 'tv',
    name: c.name,
    poster: c.logo_url
  }));

  const resp = { metas };
  cache.set(cacheKey, resp);
  return resp;
}

async function handleMeta({ id, m3uUrl }) {
  if (!m3uUrl) return { meta: null };
  const parts = id.split('_');
  const channelId = parts.slice(2).join('_');

  const m3uHash = crypto.createHash('md5').update(m3uUrl).digest('hex');
  const cacheKey = `meta_${m3uHash}_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const ch = await getChannel(channelId, { m3uUrl });
  const resp = {
    meta: {
      id,
      type: 'tv',
      name: ch.name,
      poster: ch.logo_url,
      background: ch.logo_url,
      description: ch.name
    }
  };
  cache.set(cacheKey, resp);
  return resp;
}

async function handleStream({ id, m3uUrl }) {
  if (!m3uUrl) return { streams: [] };
  const parts = id.split('_');
  const channelId = parts.slice(2).join('_');

  const m3uHash = crypto.createHash('md5').update(m3uUrl).digest('hex');
  const cacheKey = `stream_${m3uHash}_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const ch = await getChannel(channelId, { m3uUrl });
  const streams = [];

  const addStream = (src) => {
    const out = { name: src.group_title, title: src.title };
    if (src.acestream_id) {
      out.externalUrl = `acestream://${src.acestream_id}`;
      out.behaviorHints = { notWebReady: true, external: true };
    } else if (src.m3u8_url || src.stream_url || src.url) {
      out.url = src.m3u8_url || src.stream_url || src.url;
      out.behaviorHints = { notWebReady: false, external: false };
    }
    streams.push(out);
  };

  if (ch.acestream_id || ch.m3u8_url || ch.stream_url || ch.url) addStream(ch);
  (ch.additional_streams || []).forEach(addStream);
  if (ch.website_url) {
    streams.push({
      title: `${ch.name} - Website`,
      externalUrl: ch.website_url,
      behaviorHints: { notWebReady: true, external: true }
    });
  }

  const resp = { streams };
  cache.set(cacheKey, resp);
  return resp;
}

// Manifest
router.get('/manifest.json', (req, res) => {
  res.json(buildManifest(DEFAULT_CONFIG_ID));
});

router.get('/:configId/manifest.json', (req, res) => {
  const configId = req.params.configId || DEFAULT_CONFIG_ID;
  res.json(buildManifest(configId));
});

// Catalog/meta/stream con reconstrucción de extra
async function catalogRoute(req, res) {
  try {
    const id = String(req.params.id).replace(/\.json$/, '');
    const type = String(req.params.type);
    const configId = req.params.configId || extractConfigIdFromUrl(req);
    const m3uUrl = await resolveM3uUrl(configId);

    // Reconstrucción robusta de extra desde query
    const extra = {
      search: req.query.search || (req.query.extra && req.query.extra.search) || '',
      genre: req.query.genre || (req.query.extra && req.query.extra.genre) || ''
    };

    const result = await handleCatalog({ type, id, extra, m3uUrl });
    res.json(result);
  } catch (e) {
    console.error('Catalog route error:', e.message);
    res.status(200).json({ metas: [] });
  }
}

async function metaRoute(req, res) {
  try {
    const id = String(req.params.id).replace(/\.json$/, '');
    const configId = req.params.configId || extractConfigIdFromUrl(req);
    const m3uUrl = await resolveM3uUrl(configId);
    const result = await handleMeta({ id, m3uUrl });
    res.json(result);
  } catch (e) {
    console.error('Meta route error:', e.message);
    res.status(200).json({ meta: null });
  }
}

async function streamRoute(req, res) {
  try {
    const id = String(req.params.id).replace(/\.json$/, '');
    const configId = req.params.configId || extractConfigIdFromUrl(req);
    const m3uUrl = await resolveM3uUrl(configId);
    const result = await handleStream({ id, m3uUrl });
    res.json(result);
  } catch (e) {
    console.error('Stream route error:', e.message);
    res.status(200).json({ streams: [] });
  }
}

router.get('/catalog/:type/:id.json', catalogRoute);
router.get('/:configId/catalog/:type/:id.json', catalogRoute);
router.get('/meta/:type/:id.json', metaRoute);
router.get('/:configId/meta/:type/:id.json', metaRoute);
router.get('/stream/:type/:id.json', streamRoute);
router.get('/:configId/stream/:type/:id.json', streamRoute);

// Config web opcional
router.get('/configure', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <html>
      <head><title>Configure Heimdallr</title></head>
      <body style="font-family: system-ui; max-width: 720px; margin: 40px auto;">
        <h1>Configura tu lista M3U</h1>
        <p>Si no configuras nada, se usará DEFAULT_M3U_URL del entorno.</p>
        <form action="/generate-url" method="post" style="display:flex;gap:8px;">
          <input type="url" name="m3uUrl" placeholder="https://example.com/list.m3u" required style="flex:1;padding:10px;">
          <button type="submit" style="padding:10px 20px;">Generar URL</button>
        </form>
      </body>
    </html>
  `);
});

router.post('/generate-url', async (req, res) => {
  try {
    const m3uUrl = String(req.body?.m3uUrl || '').trim();
    if (!m3uUrl) throw new Error('URL M3U requerida');

    // Validación rápida
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const head = await fetch(m3uUrl, { method: 'HEAD', signal: controller.signal });
      clearTimeout(t);
      if (!head.ok) throw new Error(`HEAD ${head.status}`);
    } catch {
      const r = await fetch(m3uUrl, { method: 'GET' });
      if (!r.ok) throw new Error('La URL M3U no es accesible');
    }

    const configId = uuidv4();
    await kvSet(configId, m3uUrl);

    const baseHost = req.headers['x-forwarded-host'] || req.headers.host;
    const baseProto = req.headers['x-forwarded-proto'] || 'https';
    const manifestUrl = `${baseProto}://${baseHost}/${configId}/manifest.json`;
    const installUrl = `stremio://${encodeURIComponent(manifestUrl)}`;

    res.setHeader('Content-Type', 'text/html');
    res.end(`
      <html><body style="font-family:system-ui;max-width:720px;margin:40px auto;">
        <h1>Addon generado</h1>
        <p>Instálalo en Stremio:</p>
        <p><a href="${installUrl}" style="padding:10px 16px;background:#4CAF50;color:white;border-radius:6px;text-decoration:none;">Instalar</a></p>
        <p>O usa esta URL de manifest:</p>
        <pre style="background:#f4f4f4;padding:12px;border-radius:6px;">${manifestUrl}</pre>
      </body></html>
    `);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><body><h1>Error</h1><p>${e.message}</p></body></html>`);
  }
});

// Mount & export
app.use(router);
module.exports = app;

// Ejecución local opcional
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Heimdallr listening on http://localhost:${port}`));
}
