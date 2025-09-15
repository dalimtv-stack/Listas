// api/index.js
'use strict';

// -------------------- Constantes globales --------------------
const express = require('express');
const bodyParser = require('body-parser');
const NodeCache = require('node-cache');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
require('dotenv').config();

const { getChannels, getChannel } = require('../src/db');
const { scrapeExtraWebs } = require('./scraper');

// 🔹 Importar helpers KV desde api/kv.js
const {
  kvGet,
  kvSet,
  kvGetJson,
  kvSetJson,
  kvGetJsonTTL,
  kvSetJsonTTL
} = require('./kv');

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
const DEFAULT_M3U_URL = process.env.DEFAULT_M3U_URL || 'https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u';

// VERSION ahora se lee directamente de package.json
const { version: VERSION } = require('../package.json');

// -------------------- CORS --------------------
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// -------------------- Utils --------------------

// Helper: obtener la cadena de última actualización para mostrarla en manifest/catalog
async function getLastUpdateString(configId) {
  try {
    const raw = await kvGet(`last_update:${configId}`);
    if (raw && typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  } catch (e) {
    console.log('[UTILS] no se pudo leer last_update:', e.message);
  }
  return 'Sin actualizar aún';
}
// -------------------- Manifest dinámico --------------------
async function buildManifest(configId) {
  let genreOptions = ['General'];
  let lastUpdateStr = await getLastUpdateString(configId);

  // 🔹 Leer configuración actual para precargar valores en el manifest
  let currentM3u = '';
  let currentExtraWebs = '';
  try {
    const cfg = await kvGetJson(configId);
    if (cfg) {
      if (cfg.m3uUrl) currentM3u = cfg.m3uUrl;
      if (cfg.extraWebs) currentExtraWebs = cfg.extraWebs;
    }
  } catch (e) {
    console.error(`[MANIFEST] error al leer configuración para ${configId}:`, e.message);
  }

  try {
    const genresKV = await kvGetJsonTTL(`genres:${configId}`);
    if (Array.isArray(genresKV) && genresKV.length) {
      genreOptions = genresKV;
      console.log(`[MANIFEST] géneros cargados desde KV para ${configId}: ${genreOptions.length}`);
    }
  } catch (e) {
    console.error('[MANIFEST] error general al cargar géneros dinámicos:', e.message);
  }

  // Refrescar la etiqueta de última actualización
  try {
    lastUpdateStr = await getLastUpdateString(configId);
  } catch {}

  return {
    id: BASE_ADDON_ID,
    version: VERSION,
    name: ADDON_NAME,
    description: `Carga canales Acestream o M3U8 desde lista M3U (KV o por defecto).\nÚltima actualización de la lista M3U: ${lastUpdateStr}`,
    types: ['tv'],
    logo: 'https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960',
    resources: ['catalog', 'meta', 'stream'],
    idPrefixes: [`${ADDON_PREFIX}_`],
    behaviorHints: { configurable: true },
    config: [
      { name: 'm3uUrl', label: 'URL de la lista M3U', type: 'text', required: true, value: currentM3u },
      { name: 'extraWebs', label: 'Webs adicionales (separadas por ; o |)', type: 'text', required: false, value: currentExtraWebs }
    ],
    catalogs: [
      {
        type: 'tv',
        id: `${CATALOG_PREFIX}_${configId}`,
        name: 'Heimdallr Live Channels',
        description: `Última actualización de la lista M3U: ${lastUpdateStr}`,
        extra: [
          { name: 'search', isRequired: false },
          { name: 'genre', isRequired: false, options: genreOptions }
        ]
      }
    ]
  };
}

// -------------------- Resolver M3U y webs extra --------------------
async function resolveM3uUrl(configId) {
  const cfg = await kvGetJson(configId);
  if (cfg && cfg.m3uUrl) return cfg.m3uUrl;

  const kv = await kvGet(configId);
  if (kv) return kv;

  if (DEFAULT_M3U_URL) return DEFAULT_M3U_URL;
  return null;
}

async function resolveExtraWebs(configId) {
  try {
    const cfg = await kvGetJson(configId);
    const raw = (cfg && typeof cfg.extraWebs === 'string') ? cfg.extraWebs : '';

    if (!raw.trim()) {
      console.log(`[DEBUG] No hay extraWebs configuradas para configId=${configId}`);
      return [];
    }

    const split = raw.split(/[;|,\n]+/g)
      .map(s => s.trim())
      .filter(Boolean)
      .map(u => u.replace(/\/+$/, ''));

    const seen = new Set();
    const urls = [];
    for (const u of split) {
      try {
        const parsed = new URL(u);
        const norm = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
        if (!seen.has(norm)) {
          seen.add(norm);
          urls.push(norm);
        }
      } catch {
        console.warn(`[DEBUG] extraWeb inválida descartada: ${u}`);
      }
    }

    console.log(`[DEBUG] Extra webs configuradas para configId=${configId}:`, urls);
    return urls;
  } catch (e) {
    console.error(`[DEBUG] Error resolviendo extraWebs para ${configId}:`, e.message);
    return [];
  }
}

function extractConfigIdFromUrl(req) {
  const m = req.url.match(/^\/([^/]+)\/(manifest\.json|catalog|meta|stream)\b/);
  if (m && m[1]) return m[1];
  return DEFAULT_CONFIG_ID;
}
// ------ Parseador de rutas de catálogo estilo Stremio ------
function parseCatalogRest(restRaw) {
  const rest = decodeURIComponent(restRaw);
  const segments = rest.split('/');
  const id = segments.shift();
  const extra = {};
  for (const seg of segments) {
    const [k, v] = seg.split('=');
    if (!k || v === undefined) continue;
    const key = k.trim();
    const val = decodeURIComponent(v.trim());
    if (key === 'genre' || key === 'search') extra[key] = val;
  }
  return { id, extra };
}

// -------------------- Core handlers --------------------
async function handleCatalog({ type, id, extra, m3uUrl }) {
  const logPrefix = '[CATALOG]';
  if (type !== 'tv') return { metas: [] };
  if (!m3uUrl) return { metas: [] };

  const m3uHash = crypto.createHash('md5').update(m3uUrl).digest('hex');
  const cacheKey = `catalog_${m3uHash}_${extra?.genre || ''}_${extra?.search || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const channels = await getChannels({ m3uUrl });

  try {
    const genreSet = new Set();
    channels.forEach(c => {
      if (c.group_title) genreSet.add(c.group_title);
      if (Array.isArray(c.extra_genres)) c.extra_genres.forEach(g => genreSet.add(g));
      if (Array.isArray(c.additional_streams)) {
        c.additional_streams.forEach(s => {
          if (s.group_title) genreSet.add(s.group_title);
        });
      }
    });
    const genreList = Array.from(genreSet).filter(Boolean).sort();
    const configId = (id.startsWith(`${CATALOG_PREFIX}_`) ? id.split('_')[1] : DEFAULT_CONFIG_ID) || DEFAULT_CONFIG_ID;
    await kvSetJsonTTL(`genres:${configId}`, genreList);
  } catch (e) {
    console.error(logPrefix, 'error al extraer géneros:', e.message);
  }

  let filtered = channels;
  if (extra.search) {
    const q = String(extra.search).toLowerCase();
    filtered = filtered.filter(c => c.name?.toLowerCase().includes(q));
  }
  if (extra.genre) {
    const g = String(extra.genre);
    if (g === 'Otros') {
      filtered = filtered.filter(c => {
        const hasMain = !!c.group_title;
        const hasExtra = Array.isArray(c.extra_genres) && c.extra_genres.length > 0;
        const hasAdditional = Array.isArray(c.additional_streams) && c.additional_streams.some(s => s.group_title);
        return !hasMain && !hasExtra && !hasAdditional;
      });
    } else {
      filtered = filtered.filter(c =>
        c.group_title === g ||
        (Array.isArray(c.extra_genres) && c.extra_genres.includes(g)) ||
        (Array.isArray(c.additional_streams) && c.additional_streams.some(s => s.group_title === g))
      );
    }
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
  const logPrefix = '[META]';
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

async function handleStream({ id, m3uUrl, configId }) {
  const logPrefix = '[STREAM]';
  if (!m3uUrl) return { streams: [], chName: '' };

  const parts = id.split('_');
  const channelId = parts.slice(2).join('_');
  const m3uHash = crypto.createHash('md5').update(m3uUrl).digest('hex');
  const cacheKey = `stream_${m3uHash}_${channelId}`;

  let cached = cache.get(cacheKey);
  let chName;

  if (cached) {
    chName = cached.chName;
  } else {
    const ch = await getChannel(channelId, { m3uUrl });
    if (!ch) return { streams: [], chName: '' };

    chName = ch.name;
    let streams = [];

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

    cached = { streams, chName };
    cache.set(cacheKey, cached);
  }

  return { streams: cached.streams, chName };
}
// -------------------- Rutas de catálogo --------------------
router.get('/catalog/:type/:rest(.+)\\.json', async (req, res) => {
  const { id, extra: extraFromRest } = parseCatalogRest(req.params.rest || '');
  const configId = extractConfigIdFromUrl(req);
  const m3uUrl = await resolveM3uUrl(configId);

  const extra = {
    search: req.query.search || extraFromRest.search || '',
    genre: req.query.genre || extraFromRest.genre || ''
  };

  const m3uHash = crypto.createHash('md5').update(m3uUrl || '').digest('hex');
  const kvKey = `catalog:${m3uHash}:${extra.genre || ''}:${extra.search || ''}`;

  const kvCached = await kvGetJsonTTL(kvKey);
  if (kvCached) return res.json(kvCached);

  const result = await handleCatalog({ type: req.params.type, id, extra, m3uUrl });
  await kvSetJsonTTL(kvKey, result);
  res.json(result);
});

router.get('/:configId/catalog/:type/:rest(.+)\\.json', async (req, res) => {
  const { id, extra: extraFromRest } = parseCatalogRest(req.params.rest || '');
  const configId = req.params.configId;
  const m3uUrl = await resolveM3uUrl(configId);

  const extra = {
    search: req.query.search || extraFromRest.search || '',
    genre: req.query.genre || extraFromRest.genre || ''
  };

  const m3uHash = crypto.createHash('md5').update(m3uUrl || '').digest('hex');
  const kvKey = `catalog:${m3uHash}:${extra.genre || ''}:${extra.search || ''}`;

  const kvCached = await kvGetJsonTTL(kvKey);
  if (kvCached) return res.json(kvCached);

  const result = await handleCatalog({ type: req.params.type, id, extra, m3uUrl });
  await kvSetJsonTTL(kvKey, result);
  res.json(result);
});

// -------------------- Meta y Stream --------------------
async function metaRoute(req, res) {
  const id = String(req.params.id).replace(/\.json$/, '');
  const configId = req.params.configId || extractConfigIdFromUrl(req);
  const m3uUrl = await resolveM3uUrl(configId);

  const m3uHash = crypto.createHash('md5').update(m3uUrl || '').digest('hex');
  const kvKey = `meta:${m3uHash}:${id}`;
  const kvCached = await kvGetJsonTTL(kvKey);
  if (kvCached) return res.json(kvCached);

  const result = await handleMeta({ id, m3uUrl });
  await kvSetJsonTTL(kvKey, result);
  res.json(result);
}

async function streamRoute(req, res) {
  try {
    const id = String(req.params.id).replace(/\.json$/, '');
    const configId = req.params.configId || extractConfigIdFromUrl(req);
    const m3uUrl = await resolveM3uUrl(configId);

    const m3uHash = crypto.createHash('md5').update(m3uUrl || '').digest('hex');
    const kvKey = `stream:${m3uHash}:${id}`;
    let kvCached = await kvGetJsonTTL(kvKey);

    const enrichWithExtra = async (baseObj) => {
      if (!baseObj || typeof baseObj !== 'object') return baseObj;
      if (!Array.isArray(baseObj.streams)) baseObj.streams = [];

      let chName = baseObj.chName;
      if (!chName || typeof chName !== 'string') {
        const parts = id.split('_').slice(2);
        chName = parts.join(' ');
      }

      const extraWebsList = await resolveExtraWebs(configId);
      if (extraWebsList.length) {
        const extraStreams = await scrapeExtraWebs(chName, extraWebsList);
        const existingUrls = new Set(baseObj.streams.map(s => s.url || s.externalUrl));
        const nuevos = extraStreams.filter(s => {
          const url = s.url || s.externalUrl;
          return url && !existingUrls.has(url);
        });
        if (nuevos.length) {
          baseObj.streams.push(...nuevos);
        }
      }
      return baseObj;
    };

    if (kvCached) {
      const enriched = await enrichWithExtra(kvCached);
      if (enriched.streams.length !== (kvCached.streams?.length || 0)) {
        await kvSetJsonTTL(kvKey, enriched);
      }
      return res.json({ streams: enriched.streams });
    }

    let result = await handleStream({ id, m3uUrl, configId });
    result = await enrichWithExtra(result);
    await kvSetJsonTTL(kvKey, result);
    res.json({ streams: result.streams });

  } catch (e) {
    console.error('[STREAM] route error:', e.message);
    res.status(200).json({ streams: [] });
  }
}

router.get('/meta/:type/:id.json', metaRoute);
router.get('/:configId/meta/:type/:id.json', metaRoute);
router.get('/stream/:type/:id.json', streamRoute);
router.get('/:configId/stream/:type/:id.json', streamRoute);

// -------------------- Config web opcional --------------------
router.get('/configure', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <!DOCTYPE html>
    <html>
      <head><title>Configure Heimdallr Channels</title></head>
      <body>
        <h1>Configure Heimdallr Channels</h1>
        <form action="/generate-url" method="post">
          <input type="text" name="m3uUrl" placeholder="https://example.com/list.m3u" required>
          <input type="text" name="extraWebs" placeholder="https://web1.com;https://web2.com">
          <button type="submit">Generate Install URL</button>
        </form>
      </body>
    </html>
  `);
});

router.post('/generate-url', async (req, res) => {
  try {
    const m3uUrl = String(req.body?.m3uUrl || '').trim();
    const extraWebs = String(req.body?.extraWebs || '').trim();
    if (!m3uUrl) throw new Error('URL M3U requerida');

    const configId = uuidv4();
    await kvSetJson(configId, { m3uUrl, extraWebs });

    const baseHost = req.headers['x-forwarded-host'] || req.headers.host;
    const baseProto = req.headers['x-forwarded-proto'] || 'https';
    const manifestUrl = `${baseProto}://${baseHost}/${configId}/manifest.json`;
    const installUrl = `stremio://${encodeURIComponent(manifestUrl)}`;

    res.setHeader('Content-Type', 'text/html');
    res.end(`<a href="${installUrl}">Install Addon</a><pre>${manifestUrl}</pre>`);
  } catch (err) {
    res.status(500).end(`Error: ${err.message}`);
  }
});

// -------------------- Mount & export --------------------
app.use(router);
module.exports = app;

// -------------------- Arranque local --------------------
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Heimdallr listening on http://localhost:${port}`));
}
