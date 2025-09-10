// index.js - Heimdallr Addon (Express puro, rutas con y sin configId)

const express = require('express');
const NodeCache = require('node-cache');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
require('dotenv').config();

// Dependencias del dominio
const { getChannels, getChannel } = require('../src/db');
const { CACHE_TTL } = require('../src/config');

// -------------------- Configuración base --------------------
const app = express();
const router = express.Router();
const cache = new NodeCache({ stdTTL: CACHE_TTL || 300 });

const BASE_ADDON_ID = 'org.stremio.Heimdallr';
const ADDON_NAME = 'Heimdallr Channels';
const ADDON_PREFIX = 'heimdallr';
const CATALOG_PREFIX = 'Heimdallr';
const DEFAULT_CONFIG_ID = 'default'; // para modo por defecto (sin configurar)
const DEFAULT_M3U_URL = process.env.DEFAULT_M3U_URL || ''; // pon aquí una lista pública o deja vacío

// CORS mínimo
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// -------------------- Helpers de KV --------------------
async function kvGet(configId) {
  if (!configId) return null;
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_KV_API_TOKEN}` } });
    return r.ok ? await r.text() : null;
  } catch (e) {
    console.error('KV get error:', e.message);
    return null;
  }
}

async function kvSet(configId, value) {
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`;
    const r = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_KV_API_TOKEN}`, 'Content-Type': 'text/plain' },
      body: value
    });
    if (!r.ok) throw new Error(`KV set failed: ${r.status}`);
  } catch (e) {
    console.error('KV set error:', e.message);
    throw e;
  }
}

// -------------------- Middleware de resolución --------------------
// Extrae configId desde:
// - param de ruta :configId
// - id de catálogo "Heimdallr_<configId>"
// - por defecto "default"
router.use((req, res, next) => {
  const fromParam = req.params?.configId;
  const catalogId = req.params?.id; // en /catalog/:type/:id.json
  let configId = fromParam;

  if (!configId && catalogId && catalogId.startsWith(`${CATALOG_PREFIX}_`)) {
    const parts = catalogId.split('_');
    configId = parts[1] || DEFAULT_CONFIG_ID;
  }

  if (!configId) configId = DEFAULT_CONFIG_ID;

  req.configId = configId;
  next();
});

// Resuelve la M3U en orden: KV(configId) -> DEFAULT_M3U_URL -> null
async function resolveM3uUrl(configId) {
  const kv = await kvGet(configId);
  if (kv) return kv;
  if (DEFAULT_M3U_URL) return DEFAULT_M3U_URL;
  return null;
}

async function validateM3uUrl(url) {
  if (!url) return false;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(url, { signal: controller.signal, method: 'HEAD' });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

// -------------------- Manifest --------------------
function buildManifest(configId) {
  return {
    id: BASE_ADDON_ID,
    version: '1.3.0',
    name: ADDON_NAME,
    description: 'Carga canales Acestream o M3U8 desde una lista M3U (KV o por defecto).',
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

// Manifest por defecto (sin configId en el path)
router.get('/manifest.json', (req, res) => {
  res.json(buildManifest(DEFAULT_CONFIG_ID));
});

// Manifest con configId en el path
router.get('/:configId/manifest.json', (req, res) => {
  res.json(buildManifest(req.params.configId || DEFAULT_CONFIG_ID));
});

// -------------------- Handlers core (Express, sin SDK) --------------------
async function handleCatalog({ type, id, extra, m3uUrl }) {
  if (type !== 'tv' || !m3uUrl) return { metas: [] };

  const m3uHash = crypto.createHash('md5').update(m3uUrl).digest('hex');
  const cacheKey = `catalog_${m3uHash}_${extra?.genre || ''}_${extra?.search || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const channels = await getChannels({ m3uUrl });
  let filtered = channels;

  if (extra?.search) {
    const q = String(extra.search).toLowerCase();
    filtered = filtered.filter(c => c.name?.toLowerCase().includes(q));
  }
  if (extra?.genre) {
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

// -------------------- Rutas Stremio (con y sin configId en path) --------------------
// Catalog
router.get(['/catalog/:type/:id.json', '/:configId/catalog/:type/:id.json'], async (req, res) => {
  try {
    const id = req.params.id.replace(/\.json$/, '');
    const type = req.params.type;
    const extra = req.query || {};
    const configId = req.configId || DEFAULT_CONFIG_ID;
    const m3uUrl = await resolveM3uUrl(configId);
    const result = await handleCatalog({ type, id, extra, m3uUrl });
    res.json(result);
  } catch (e) {
    console.error('Catalog route error:', e.message);
    res.status(200).json({ metas: [] });
  }
});

// Meta
router.get(['/meta/:type/:id.json', '/:configId/meta/:type/:id.json'], async (req, res) => {
  try {
    const id = req.params.id.replace(/\.json$/, '');
    const configId = req.configId || DEFAULT_CONFIG_ID;
    const m3uUrl = await resolveM3uUrl(configId);
    const result = await handleMeta({ id, m3uUrl });
    res.json(result);
  } catch (e) {
    console.error('Meta route error:', e.message);
    res.status(200).json({ meta: null });
  }
});

// Stream
router.get(['/stream/:type/:id.json', '/:configId/stream/:type/:id.json'], async (req, res) => {
  try {
    const id = req.params.id.replace(/\.json$/, '');
    const configId = req.configId || DEFAULT_CONFIG_ID;
    const m3uUrl = await resolveM3uUrl(configId);
    const result = await handleStream({ id, m3uUrl });
    res.json(result);
  } catch (e) {
    console.error('Stream route error:', e.message);
    res.status(200).json({ streams: [] });
  }
});

// -------------------- Configuración web (opcional) --------------------
router.get('/configure', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <html>
      <head><title>Configure Heimdallr</title></head>
      <body style="font-family: system-ui; max-width: 720px; margin: 40px auto;">
        <h1>Configura tu lista M3U</h1>
        <p>Si no configuras nada, el addon usará la lista por defecto (DEFAULT_M3U_URL).</p>
        <form action="/generate-url" method="post" style="display:flex;gap:8px;">
          <input type="url" name="m3uUrl" placeholder="https://example.com/list.m3u" required style="flex:1;padding:10px;">
          <button type="submit" style="padding:10px 20px;">Generar URL</button>
        </form>
      </body>
    </html>
  `);
});

router.post('/generate-url', bodyParser.urlencoded({ extended: false }), async (req, res) => {
  try {
    const m3uUrl = (req.body?.m3uUrl || '').trim();
    const ok = await validateM3uUrl(m3uUrl);
    if (!ok) throw new Error('La URL M3U no es accesible');

    const configId = uuidv4();
    await kvSet(configId, m3uUrl);

    const baseHost = req.headers['x-forwarded-host'] || req.headers.host;
    const baseProto = (req.headers['x-forwarded-proto'] || 'https');
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

// -------------------- Export --------------------
module.exports = router;
