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
const KV_TTL_MS = 60 * 60 * 1000; // 1 hora en milisegundos

const BASE_ADDON_ID = 'org.stremio.Heimdallr';
const ADDON_NAME = 'Heimdallr Channels';
const ADDON_PREFIX = 'heimdallr';
const CATALOG_PREFIX = 'Heimdallr';
const DEFAULT_CONFIG_ID = 'default';
const DEFAULT_M3U_URL = process.env.DEFAULT_M3U_URL || 'https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u';

// -------------------- CORS --------------------
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// -------------------- KV helpers --------------------
async function kvGet(configId) {
  if (!configId) return null;
  try {
    const { CLOUDFLARE_KV_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID, CLOUDFLARE_KV_API_TOKEN } = process.env;
    if (!CLOUDFLARE_KV_ACCOUNT_ID || !CLOUDFLARE_KV_NAMESPACE_ID || !CLOUDFLARE_KV_API_TOKEN) return null;
    const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${CLOUDFLARE_KV_API_TOKEN}` } });
    return r.ok ? await r.text() : null;
  } catch (e) {
    console.error('[KV] get error:', e.message);
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

async function buildManifest(configId) {
  let genreOptions = ['General'];
  let lastUpdateStr = await getLastUpdateString(configId);

  try {
    const genresKV = await kvGetJsonTTL(`genres:${configId}`);
    if (Array.isArray(genresKV) && genresKV.length) {
      genreOptions = genresKV;
      console.log(`[MANIFEST] géneros cargados desde KV para ${configId}: ${genreOptions.length}`);
    } else {
      console.log(`[MANIFEST] géneros no encontrados en KV para ${configId}, intentando precargar desde M3U...`);

      const m3uUrl = await resolveM3uUrl(configId);
      if (m3uUrl) {
        try {
          const channels = await getChannels({ m3uUrl });

          const genreSet = new Set();
          let orphanCount = 0;

          channels.forEach(c => {
            const hasMain = !!c.group_title;
            const hasExtra = Array.isArray(c.extra_genres) && c.extra_genres.length > 0;
            const hasAdditional = Array.isArray(c.additional_streams) && c.additional_streams.some(s => s.group_title);
            if (hasMain) genreSet.add(c.group_title);
            if (hasExtra) c.extra_genres.forEach(g => genreSet.add(g));
            if (hasAdditional) c.additional_streams.forEach(s => s.group_title && genreSet.add(s.group_title));
            if (!hasMain && !hasExtra && !hasAdditional) orphanCount++;
          });

          const genreList = Array.from(genreSet).filter(Boolean).sort();
          if (orphanCount > 0 && !genreList.includes('Otros')) genreList.push('Otros');

          if (genreList.length) {
            await kvSetJsonTTL(`genres:${configId}`, genreList);
            genreOptions = genreList;
            console.log(`[MANIFEST] géneros extraídos y guardados desde M3U para ${configId}: ${genreOptions.length} (incluye Otros=${orphanCount > 0})`);
          } else {
            console.log(`[MANIFEST] sin géneros detectados en la M3U para ${configId}, usando fallback`);
          }
        } catch (e) {
          console.error(`[MANIFEST] error al extraer géneros desde M3U para ${configId}:`, e.message);
        }
      } else {
        console.log(`[MANIFEST] no hay M3U resuelta para ${configId}, usando fallback`);
      }
    }
  } catch (e) {
    console.error('[MANIFEST] error general al cargar géneros dinámicos:', e.message);
  }

  // Refrescar la etiqueta de última actualización por si se generó antes
  // (No bloqueante; si falla, mantenemos el valor leído al inicio)
  try {
    lastUpdateStr = await getLastUpdateString(configId);
  } catch {}

  return {
    id: BASE_ADDON_ID,
    version: '1.3.5',
    name: ADDON_NAME,
    description: `Carga canales Acestream o M3U8 desde lista M3U (KV o por defecto).\nÚltima actualización de la lista M3U: ${lastUpdateStr}`,
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
        description: `Última actualización: ${lastUpdateStr}`,
        extra: [
          { name: 'search', isRequired: false },
          { name: 'genre', isRequired: false, options: genreOptions }
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

// Parseador de rutas de catálogo estilo Stremio:
// - rest = "Heimdallr_<configId>"
// - o "Heimdallr_<configId>/genre=Telegram"
// - o "Heimdallr_<configId>/search=foo/genre=Bar"
function parseCatalogRest(restRaw) {
  const rest = decodeURIComponent(restRaw);
  const segments = rest.split('/');
  const id = segments.shift(); // "Heimdallr_<configId>"
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
  if (type !== 'tv') {
    console.log(logPrefix, 'type no soportado:', type);
    return { metas: [] };
  }
  if (!m3uUrl) {
    console.log(logPrefix, 'm3uUrl no resuelta');
    return { metas: [] };
  }

  const m3uHash = crypto.createHash('md5').update(m3uUrl).digest('hex');
  const cacheKey = `catalog_${m3uHash}_${extra?.genre || ''}_${extra?.search || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(logPrefix, 'cache HIT', cacheKey);
    return cached;
  } else {
    console.log(logPrefix, 'cache MISS', cacheKey);
  }

  const channels = await getChannels({ m3uUrl });
  console.log(logPrefix, `canales cargados: ${channels.length}`);

  // Extraer géneros únicos y guardar en KV
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
    console.log(logPrefix, `géneros extraídos: ${genreList.length}`);
  } catch (e) {
    console.error(logPrefix, 'error al extraer géneros:', e.message);
  }

  let filtered = channels;

  if (extra.search) {
    const q = String(extra.search).toLowerCase();
    filtered = filtered.filter(c => c.name?.toLowerCase().includes(q));
    console.log(logPrefix, `aplicado search="${q}", tras filtro: ${filtered.length}`);
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
  console.log(logPrefix, `aplicado genre="${g}", tras filtro: ${filtered.length}`);
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
  console.log(logPrefix, `respuesta metas: ${metas.length}`);
  return resp;
}

async function handleMeta({ id, m3uUrl }) {
  const logPrefix = '[META]';
  if (!m3uUrl) {
    console.log(logPrefix, 'm3uUrl no resuelta');
    return { meta: null };
  }
  const parts = id.split('_');
  const channelId = parts.slice(2).join('_');

  const m3uHash = crypto.createHash('md5').update(m3uUrl).digest('hex');
  const cacheKey = `meta_${m3uHash}_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(logPrefix, 'cache HIT', cacheKey);
    return cached;
  } else {
    console.log(logPrefix, 'cache MISS', cacheKey);
  }

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
  console.log(logPrefix, `meta para ${channelId}: ${ch.name}`);
  return resp;
}

async function handleStream({ id, m3uUrl }) {
  const logPrefix = '[STREAM]';
  if (!m3uUrl) {
    console.log(logPrefix, 'm3uUrl no resuelta');
    return { streams: [] };
  }
  const parts = id.split('_');
  const channelId = parts.slice(2).join('_');

  const m3uHash = crypto.createHash('md5').update(m3uUrl).digest('hex');
  const cacheKey = `stream_${m3uHash}_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(logPrefix, 'cache HIT', cacheKey);
    return cached;
  } else {
    console.log(logPrefix, 'cache MISS', cacheKey);
  }

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
  console.log(logPrefix, `streams para ${channelId}: ${streams.length}`);
  return resp;
}

// -------------------- Manifest --------------------
router.get('/manifest.json', async (req, res) => {
  console.log('[MANIFEST] default', req.originalUrl);
  try {
    const manifest = await buildManifest(DEFAULT_CONFIG_ID);
    res.json(manifest);
  } catch (e) {
    console.error('[MANIFEST] error al generar default:', e.message);
    res.status(500).json({});
  }
});

router.get('/:configId/manifest.json', async (req, res) => {
  const configId = req.params.configId || DEFAULT_CONFIG_ID;
  console.log('[MANIFEST]', configId, req.originalUrl);
  try {
    const manifest = await buildManifest(configId);
    res.json(manifest);
  } catch (e) {
    console.error(`[MANIFEST] error al generar para ${configId}:`, e.message);
    res.status(500).json({});
  }
});

// -------------------- Catalog con soporte de "rest" + logs + KV TTL --------------------
async function kvGetJsonTTL(key) {
  const val = await kvGet(key);
  if (!val) return null;
  try {
    const parsed = JSON.parse(val);
    if (!parsed.timestamp || !parsed.data) return null;
    const age = Date.now() - parsed.timestamp;
    if (age > KV_TTL_MS) {
      console.log(`[KV] Caducado (${Math.round(age / 60000)} min)`, key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

async function kvSetJsonTTL(key, obj) {
  const payload = {
    timestamp: Date.now(),
    data: obj
  };
  await kvSet(key, JSON.stringify(payload));
}

// -------------------- Extraer y guardar géneros solo si cambia la M3U --------------------
async function extractAndStoreGenresIfChanged(channels, configId) {
  try {
    // 1) Calcular hash del contenido relevante para detectar cambios
    const m3uText = channels.map(c => {
      const extras = Array.isArray(c.extra_genres) ? c.extra_genres.join(',') : '';
      const adds = Array.isArray(c.additional_streams)
        ? c.additional_streams.map(s => s.group_title || '').join(',')
        : '';
      return `${c.group_title || ''}|${extras}|${adds}|${c.name || ''}`;
    }).join('\n');
    const currentHash = crypto.createHash('md5').update(m3uText).digest('hex');

    // 2) Leer último hash guardado en KV (sin TTL)
    const lastHashKey = `genres_hash:${configId}`;
    const lastHash = await kvGet(lastHashKey);

    if (lastHash && lastHash === currentHash) {
      console.log('[GENRES] M3U sin cambios, no se recalculan géneros');
      return; // No recalcular
    }

    // 3) Contar por canal+género y detectar huérfanos
    const genreCount = new Map();
    let orphanCount = 0;

    channels.forEach(c => {
      const seenGenresForThisChannel = new Set();

      // Género principal
      if (c.group_title) {
        seenGenresForThisChannel.add(c.group_title);
      }

      // Géneros extra
      if (Array.isArray(c.extra_genres)) {
        c.extra_genres.forEach(g => g && seenGenresForThisChannel.add(g));
      }

      // Géneros de additional_streams
      if (Array.isArray(c.additional_streams)) {
        c.additional_streams.forEach(s => {
          if (s && s.group_title) {
            seenGenresForThisChannel.add(s.group_title);
          }
        });
      }

      if (seenGenresForThisChannel.size > 0) {
        seenGenresForThisChannel.forEach(g => {
          genreCount.set(g, (genreCount.get(g) || 0) + 1);
        });
      } else {
        orphanCount++;
      }
    });

    if (orphanCount > 0) {
      genreCount.set('Otros', orphanCount);
    }

    // 4) Ordenar por número de canales (desc) y luego alfabéticamente
    const genreList = Array.from(genreCount.entries())
      .sort((a, b) => {
        if (b[1] === a[1]) return a[0].localeCompare(b[0], 'es', { sensitivity: 'base' });
        return b[1] - a[1];
      })
      .map(([genre]) => genre);

    // 5) Guardar géneros (con TTL), hash (sin TTL) y timestamp de última actualización
    if (genreList.length) {
      await kvSetJsonTTL(`genres:${configId}`, genreList);
      await kvSet(lastHashKey, currentHash);

      // NUEVO: guardar fecha/hora de última actualización
      const nowStr = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
      await kvSet(`last_update:${configId}`, nowStr);

      console.log(`[GENRES] extraídos y guardados: ${genreList.length} géneros (Otros=${orphanCount})`);
      console.log(`[GENRES] última actualización registrada: ${nowStr}`);
    }
  } catch (e) {
    console.error('[GENRES] error al extraer:', e.message);
  }
}

router.get('/catalog/:type/:rest(.+)\\.json', async (req, res) => {
  console.log('[ROUTE] CATALOG (sin configId)', {
    url: req.originalUrl,
    params: req.params,
    query: req.query
  });
  await catalogRouteParsed(req, res, null);
});

router.get('/:configId/catalog/:type/:rest(.+)\\.json', async (req, res) => {
  console.log('[ROUTE] CATALOG (con configId)', {
    url: req.originalUrl,
    params: req.params,
    query: req.query
  });
  await catalogRouteParsed(req, res, req.params.configId);
});

async function catalogRouteParsed(req, res, configIdFromPath) {
  try {
    const type = String(req.params.type);
    const { id, extra: extraFromRest } = parseCatalogRest(req.params.rest || '');
    const configId = configIdFromPath || extractConfigIdFromUrl(req);
    const m3uUrl = await resolveM3uUrl(configId);

    const extra = {
      search: req.query.search || (req.query.extra && req.query.extra.search) || extraFromRest.search || '',
      genre: req.query.genre || (req.query.extra && req.query.extra.genre) || extraFromRest.genre || ''
    };

    console.log('[CATALOG] parsed', { type, id, configId, extra, m3uUrl: m3uUrl ? '[ok]' : null });

    const m3uHash = crypto.createHash('md5').update(m3uUrl || '').digest('hex');
    const kvKey = `catalog:${m3uHash}:${extra.genre || ''}:${extra.search || ''}`;

    // 1) Intentar servir desde KV
    const kvCached = await kvGetJsonTTL(kvKey);
    if (kvCached) {
      console.log('[CATALOG] KV HIT', kvKey);
      // Recalcular géneros solo si la M3U cambió
      try {
        const channels = await getChannels({ m3uUrl });
        await extractAndStoreGenresIfChanged(channels, configId);
      } catch (e) {
        console.error('[CATALOG] error al actualizar géneros tras KV HIT:', e.message);
      }
      return res.json(kvCached);
    }

    // 2) Generar catálogo fresco
    let result;
    try {
      result = await handleCatalog({ type, id, extra, m3uUrl });
      await kvSetJsonTTL(kvKey, result);
    } catch (e) {
      console.error('[CATALOG] error en handleCatalog:', e.message);
      result = { metas: [] };
    }

    // 3) Recalcular géneros solo si la M3U cambió
    try {
      const channels = await getChannels({ m3uUrl });
      await extractAndStoreGenresIfChanged(channels, configId);
    } catch (e) {
      console.error('[CATALOG] error al actualizar géneros tras MISS:', e.message);
    }

    return res.json(result);
  } catch (e) {
    console.error('[CATALOG] route error:', e.message);
    return res.status(200).json({ metas: [] });
  }
}
// -------------------- Meta y Stream con KV cache + TTL 1h --------------------
async function kvGetJsonTTL(key) {
  const val = await kvGet(key);
  if (!val) return null;
  try {
    const parsed = JSON.parse(val);
    if (!parsed.timestamp || !parsed.data) return null;
    const age = Date.now() - parsed.timestamp;
    if (age > KV_TTL_MS) {
      console.log(`[KV] Caducado (${Math.round(age / 60000)} min)`, key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

async function kvSetJsonTTL(key, obj) {
  const payload = {
    timestamp: Date.now(),
    data: obj
  };
  await kvSet(key, JSON.stringify(payload));
}

async function metaRoute(req, res) {
  try {
    const id = String(req.params.id).replace(/\.json$/, '');
    const configId = req.params.configId || extractConfigIdFromUrl(req);
    const m3uUrl = await resolveM3uUrl(configId);
    console.log('[ROUTE] META', { url: req.originalUrl, id, configId, m3uUrl: m3uUrl ? '[ok]' : null });

    const m3uHash = crypto.createHash('md5').update(m3uUrl || '').digest('hex');
    const kvKey = `meta:${m3uHash}:${id}`;
    const kvCached = await kvGetJsonTTL(kvKey);
    if (kvCached) {
      console.log('[META] KV HIT', kvKey);
      return res.json(kvCached);
    }

    const result = await handleMeta({ id, m3uUrl });
    await kvSetJsonTTL(kvKey, result);
    res.json(result);
  } catch (e) {
    console.error('[META] route error:', e.message);
    res.status(200).json({ meta: null });
  }
}

async function streamRoute(req, res) {
  try {
    const id = String(req.params.id).replace(/\.json$/, '');
    const configId = req.params.configId || extractConfigIdFromUrl(req);
    const m3uUrl = await resolveM3uUrl(configId);
    console.log('[ROUTE] STREAM', { url: req.originalUrl, id, configId, m3uUrl: m3uUrl ? '[ok]' : null });

    const m3uHash = crypto.createHash('md5').update(m3uUrl || '').digest('hex');
    const kvKey = `stream:${m3uHash}:${id}`;
    const kvCached = await kvGetJsonTTL(kvKey);
    if (kvCached) {
      console.log('[STREAM] KV HIT', kvKey);
      return res.json(kvCached);
    }

    const result = await handleStream({ id, m3uUrl });
    await kvSetJsonTTL(kvKey, result);
    res.json(result);
  } catch (e) {
    console.error('[STREAM] route error:', e.message);
    res.status(200).json({ streams: [] });
  }
}

router.get('/meta/:type/:id.json', metaRoute);
router.get('/:configId/meta/:type/:id.json', metaRoute);
router.get('/stream/:type/:id.json', streamRoute);
router.get('/:configId/stream/:type/:id.json', streamRoute);

// -------------------- Endpoint de salud --------------------
router.get('/health', async (req, res) => {
  try {
    const defaultUrl = await resolveM3uUrl(DEFAULT_CONFIG_ID);
    res.json({
      status: 'ok',
      defaultM3uConfigured: !!DEFAULT_M3U_URL,
      kvReachable: !!(await kvGet(DEFAULT_CONFIG_ID)),
      m3uUrl: defaultUrl || null
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// -------------------- Config web opcional --------------------
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

// -------------------- Generate URL route --------------------
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
              navigator.clipboard.writeText('${manifestUrl}').then(() => {
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
          <pre>${manifestUrl}</pre>
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

// -------------------- Mount & export --------------------
app.use(router);
module.exports = app;

// Local
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Heimdallr listening on http://localhost:${port}`));
}
