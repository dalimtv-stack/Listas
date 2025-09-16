// api/index.js
'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const NodeCache = require('node-cache');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
require('dotenv').config();

const { getChannels, getChannel } = require('../src/db');
const { scrapeExtraWebs } = require('./scraper');
const { kvGet, kvSet, kvGetJson, kvSetJson, kvGetJsonTTL, kvSetJsonTTL } = require('./kv');

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
const VERSION = '1.3.702';

// Función auxiliar para normalizar nombres (quitando paréntesis pero manteniendo corchetes)
function normalizeCatalogName(name) {
  if (!name) return '';
  return name
    .replace(/\s*\([^)]*\)\s*/g, ' ') // Elimina contenido entre paréntesis y los paréntesis
    .trim() // Elimina espacios sobrantes
    .replace(/\s+/g, ' '); // Normaliza espacios múltiples
}

// -------------------- CORS --------------------
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// -------------------- Utils --------------------
function getM3uHash(m3uUrl) {
  return crypto.createHash('md5').update(m3uUrl || '').digest('hex');
}

async function getLastUpdateString(configId) {
  try {
    const raw = await kvGet(`last_update:${configId}`);
    if (raw && typeof raw === 'string' && raw.trim()) return raw.trim();
  } catch {}
  return 'Sin actualizar aún';
}

function extractConfigIdFromUrl(req) {
  const m = req.url.match(/^\/([^/]+)\/(manifest\.json|catalog|meta|stream)\b/);
  return m && m[1] ? m[1] : DEFAULT_CONFIG_ID;
}

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

// -------------------- Manifest dinámico --------------------
async function buildManifest(configId) {
  let genreOptions = ['General'];
  const lastUpdateStr = await getLastUpdateString(configId);
  let currentM3u = '';
  let currentExtraWebs = '';

  try {
    const cfg = await kvGetJson(configId);
    if (cfg) {
      currentM3u = cfg.m3uUrl || '';
      currentExtraWebs = cfg.extraWebs || '';
    }
  } catch {}

  try {
    const genresKV = await kvGetJsonTTL(`genres:${configId}`);
    if (Array.isArray(genresKV) && genresKV.length > 1) { // Solo 'General' no cuenta como género válido
      genreOptions = genresKV;
      console.log(`[MANIFEST] géneros cargados desde KV para ${configId}: ${genreOptions.length}`);
    } else {
      console.warn(`[MANIFEST] No se encontraron géneros válidos en KV para ${configId}, usando ['General']`);
    }
  } catch (e) {
    console.error(`[MANIFEST] error al cargar géneros para ${configId}:`, e.message);
  }

  return {
    id: BASE_ADDON_ID,
    version: VERSION,
    name: ADDON_NAME,
    description: `Carga canales Acestream o M3U8 desde lista M3U.\nÚltima actualización: ${lastUpdateStr}`,
    types: ['tv'],
    logo: 'https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960',
    resources: ['catalog', 'meta', 'stream'],
    idPrefixes: [`${ADDON_PREFIX}_`],
    behaviorHints: { configurable: true },
    config: [
      { name: 'm3uUrl', label: 'URL de la lista M3U', type: 'text', required: true, value: currentM3u },
      { name: 'extraWebs', label: 'Webs adicionales', type: 'text', required: false, value: currentExtraWebs }
    ],
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
    if (!raw.trim()) return [];
    const split = raw.split(/[;|,\n]+/g).map(s => s.trim()).filter(Boolean).map(u => u.replace(/\/+$/, ''));
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
    return urls;
  } catch (e) {
    console.error(`[DEBUG] Error resolviendo extraWebs para ${configId}:`, e.message);
    return [];
  }
}

// -------------------- Handlers principales --------------------
async function handleCatalog({ type, id, extra, m3uUrl }) {
  const logPrefix = '[CATALOG]';
  if (type !== 'tv' || !m3uUrl) {
    console.log(logPrefix, type !== 'tv' ? `type no soportado: ${type}` : 'm3uUrl no resuelta');
    return { metas: [] };
  }

  const configId = (id.startsWith(`${CATALOG_PREFIX}_`) ? id.split('_')[1] : DEFAULT_CONFIG_ID) || DEFAULT_CONFIG_ID;
  const m3uHash = getM3uHash(m3uUrl);
  const cacheKey = `catalog_${m3uHash}_${extra?.genre || ''}_${extra?.search || ''}`;
  const cached = cache.get(cacheKey);

  // Verificar si la M3U ha cambiado comparando el hash
  const storedM3uHashKey = `m3u_hash:${configId}`;
  const storedM3uHash = await kvGet(storedM3uHashKey);

  let channels;
  try {
    if (!storedM3uHash || storedM3uHash !== m3uHash) {
      console.log(logPrefix, `M3U hash cambiado o no existe, recargando canales para ${configId}`);
      channels = await getChannels({ m3uUrl });
      console.log(logPrefix, `canales cargados: ${channels.length}`);
      await kvSet(storedM3uHashKey, m3uHash); // Actualizar hash almacenado
    } else if (cached) {
      console.log(logPrefix, 'cache HIT y M3U sin cambios', cacheKey);
      return cached;
    } else {
      channels = await getChannels({ m3uUrl });
      console.log(logPrefix, `canales cargados (sin cambio de hash): ${channels.length}`);
    }
  } catch (e) {
    console.error(logPrefix, `error cargando canales: ${e.message}`);
    return { metas: [] };
  }

  // Forzar actualización de géneros si el listado está vacío
  try {
    const genresKV = await kvGetJsonTTL(`genres:${configId}`);
    if (!Array.isArray(genresKV) || genresKV.length <= 1) { // Solo 'General' no cuenta como género válido
      console.log(logPrefix, `Géneros vacíos o no válidos para ${configId}, generando nuevos géneros`);
      await extractAndStoreGenresIfChanged(channels, configId);
    }
  } catch (e) {
    console.error(logPrefix, `Error verificando géneros para ${configId}:`, e.message);
  }

  let filtered = channels;
  if (extra.search) {
    const q = String(extra.search).toLowerCase();
    filtered = filtered.filter(c => normalizeCatalogName(c.name).toLowerCase().includes(q));
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

  const metas = filtered.map(c => ({
    id: `${ADDON_PREFIX}_${configId}_${c.id}`,
    type: 'tv',
    name: normalizeCatalogName(c.name), // Aplicar normalización aquí
    poster: c.logo_url
  }));

  const resp = { metas };
  cache.set(cacheKey, resp);
  await kvSetJsonTTL(`catalog:${m3uHash}:${extra?.genre || ''}:${extra?.search || ''}`, resp);
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

  const m3uHash = getM3uHash(m3uUrl);
  const cacheKey = `meta_${m3uHash}_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(logPrefix, 'cache HIT', cacheKey);
    return cached;
  }

  const ch = await getChannel(channelId, { m3uUrl });
  if (!ch) {
    console.log(logPrefix, `canal no encontrado: ${channelId}`);
    return { meta: null };
  }

  const resp = {
    meta: {
      id,
      type: 'tv',
      name: ch.name, // Mantener nombre original en meta
      poster: ch.logo_url,
      background: ch.logo_url,
      description: ch.name
    }
  };
  cache.set(cacheKey, resp);
  await kvSetJsonTTL(`meta:${m3uHash}:${channelId}`, resp);
  console.log(logPrefix, `meta para ${channelId}: ${ch.name}`);
  return resp;
}

async function handleStream({ id, m3uUrl, configId }) {
  const logPrefix = '[STREAM]';
  if (!m3uUrl) {
    console.log(logPrefix, 'm3uUrl no resuelta');
    return { streams: [], chName: '' };
  }
  const parts = id.split('_');
  const channelId = parts.slice(2).join('_');

  const m3uHash = getM3uHash(m3uUrl);
  const cacheKey = `stream_${m3uHash}_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(logPrefix, 'cache HIT', cacheKey);
    const enriched = await enrichWithExtra(cached, configId, m3uUrl);
    return enriched;
  }

  let result = await handleStreamInternal({ id, m3uUrl, configId });
  const enriched = await enrichWithExtra(result, configId, m3uUrl);
  await kvSetJsonTTL(cacheKey, enriched);
  return enriched;
}

async function handleStreamInternal({ id, m3uUrl, configId }) {
  const logPrefix = '[STREAM]';
  const parts = id.split('_');
  const channelId = parts.slice(2).join('_');

  const ch = await getChannel(channelId, { m3uUrl });
  if (!ch) {
    console.log(logPrefix, `canal no encontrado: ${channelId}`);
    return { streams: [], chName: '' };
  }

  const chName = ch.name;
  let streams = [];

  const addStream = (src) => {
    const out = { name: src.group_title || src.name, title: src.title || src.name };
    if (src.acestream_id) {
      out.externalUrl = `acestream://${src.acestream_id}`;
      out.behaviorHints = { notWebReady: true, external: true };
    } else if (src.m3u8_url || src.stream_url || src.url) {
      out.url = src.m3u8_url || src.stream_url || src.url;
      out.behaviorHints = { notWebReady: false, external: false };
    }
    if (src.group_title) out.group_title = src.group_title;
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

  const resp = { streams, chName };
  console.log(logPrefix, `streams para ${channelId}: ${streams.length}`);
  return resp;
}

async function enrichWithExtra(baseObj, configId, m3uUrl) {
  const logPrefix = '[STREAM]';
  const chName = baseObj.chName || baseObj.id.split('_').slice(2).join(' ');
  const extraWebsList = await resolveExtraWebs(configId);
  if (extraWebsList.length) {
    try {
      const extraStreams = await scrapeExtraWebs(chName, extraWebsList);
      console.log('[STREAM] Streams extra devueltos por scraper:', extraStreams);
      if (extraStreams.length > 0) {
        const existingUrls = new Set(baseObj.streams.map(s => s.url || s.externalUrl));
        const nuevos = extraStreams.filter(s => {
          const url = s.url || s.externalUrl;
          return url && !existingUrls.has(url);
        });
        if (nuevos.length) {
          // Reordenar: extra streams primero, luego streams originales
          baseObj.streams = [...nuevos, ...baseObj.streams.filter(s => !nuevos.some(n => (n.url || n.externalUrl) === (s.url || s.externalUrl)))];
          console.log(`[STREAM] Añadidos ${nuevos.length} streams extra para ${chName} con group_title`);
        } else {
          console.log(`[STREAM] No se añadieron streams extra para ${chName} (sin coincidencias)`);
        }
      } else {
        console.log(`[STREAM] No se añadieron streams extra para ${chName} (sin coincidencias)`);
      }
    } catch (e) {
      console.error(`[STREAM] Error en scrapeExtraWebs para ${chName}:`, e.message);
    }
  }
  console.log('[STREAM] Respuesta final con streams:', baseObj.streams);
  return baseObj;
}

// -------------------- Extraer y guardar géneros --------------------
async function extractAndStoreGenresIfChanged(channels, configId) {
  try {
    const m3uText = channels.map(c => {
      const extras = Array.isArray(c.extra_genres) ? c.extra_genres.join(',') : '';
      const adds = Array.isArray(c.additional_streams)
        ? c.additional_streams.map(s => s.group_title || '').join(',')
        : '';
      return `${c.group_title || ''}|${extras}|${adds}|${c.name || ''}`;
    }).join('\n');
    const currentHash = crypto.createHash('md5').update(m3uText).digest('hex');

    const lastHashKey = `genres_hash:${configId}`;
    const lastHash = await kvGet(lastHashKey);
    const lastUpdateKey = `last_update:${configId}`;
    const lastUpdate = await kvGet(lastUpdateKey);

    const genreCount = new Map();
    let orphanCount = 0;

    channels.forEach(c => {
      const seenGenres = new Set();
      if (c.group_title) seenGenres.add(c.group_title);
      if (Array.isArray(c.extra_genres)) c.extra_genres.forEach(g => g && seenGenres.add(g));
      if (Array.isArray(c.additional_streams)) {
        c.additional_streams.forEach(s => {
          if (s && s.group_title) seenGenres.add(s.group_title);
        });
      }
      if (seenGenres.size > 0) {
        seenGenres.forEach(g => genreCount.set(g, (genreCount.get(g) || 0) + 1));
      } else {
        orphanCount++;
      }
    });

    if (orphanCount > 0) genreCount.set('Otros', orphanCount);

    const genreList = Array.from(genreCount.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es', { sensitivity: 'base' }))
      .map(([g]) => g);

    if (genreList.length) {
      const nowStr = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
      if (!lastHash || lastHash !== currentHash) {
        await kvSetJsonTTL(`genres:${configId}`, genreList, 24 * 3600); // TTL de 24 horas
        await kvSet(lastHashKey, currentHash);
        await kvSet(lastUpdateKey, nowStr);
        console.log(`[GENRES] actualizados: ${genreList.length} géneros (Otros=${orphanCount})`);
      } else if (!lastUpdate) {
        await kvSet(lastUpdateKey, nowStr);
        console.log(`[GENRES] timestamp inicial registrado: ${nowStr}`);
      } else {
        console.log(`[GENRES] géneros sin cambios, usando caché: ${genreList.length}`);
      }
    } else {
      console.warn(`[GENRES] No se encontraron géneros válidos para ${configId}`);
    }
  } catch (e) {
    console.error('[GENRES] error al extraer:', e.message);
  }
}

// -------------------- Rutas MANIFEST --------------------
router.get('/manifest.json', async (req, res) => {
  try {
    const manifest = await buildManifest(DEFAULT_CONFIG_ID);
    res.json(manifest);
  } catch (e) {
    console.error('[MANIFEST] error al generar default:', e.message);
    res.status(500).json({});
  }
});

router.get('/:configId/manifest.json', async (req, res) => {
  try {
    const manifest = await buildManifest(req.params.configId);
    res.json(manifest);
  } catch (e) {
    console.error(`[MANIFEST] error al generar para ${req.params.configId}:`, e.message);
    res.status(500).json({});
  }
});

// -------------------- Rutas de catálogo --------------------
router.get('/:configId/catalog/:type/:rest(.+)\\.json', async (req, res) => {
  console.log('[ROUTE] CATALOG', { url: req.originalUrl, params: req.params, query: req.query });
  try {
    const type = String(req.params.type);
    const { id, extra: extraFromRest } = parseCatalogRest(req.params.rest || '');
    const configId = req.params.configId || extractConfigIdFromUrl(req);
    const m3uUrl = await resolveM3uUrl(configId);
    const extra = {
      search: req.query.search || extraFromRest.search || '',
      genre: req.query.genre || extraFromRest.genre || ''
    };

    console.log('[CATALOG] parsed', { type, id, configId, extra, m3uUrl: m3uUrl ? '[ok]' : null });

    const m3uHash = getM3uHash(m3uUrl);
    const kvKey = `catalog:${m3uHash}:${extra.genre || ''}:${extra.search || ''}`;

    const kvCached = await kvGetJsonTTL(kvKey);
    if (kvCached) {
      console.log('[CATALOG] KV HIT', kvKey);
      return res.json(kvCached);
    }

    let result;
    try {
      result = await handleCatalog({ type, id, extra, m3uUrl });
      await kvSetJsonTTL(kvKey, result);
    } catch (e) {
      console.error('[CATALOG] error en handleCatalog:', e.message);
      result = { metas: [] };
    }

    return res.json(result);
  } catch (e) {
    console.error('[CATALOG] route error:', e.message);
    return res.status(200).json({ metas: [] });
  }
});

// -------------------- Rutas META y STREAM --------------------
router.get('/:configId/meta/:type/:id.json', async (req, res) => {
  try {
    const id = String(req.params.id).replace(/\.json$/, '');
    const configId = req.params.configId || extractConfigIdFromUrl(req);
    const m3uUrl = await resolveM3uUrl(configId);
    console.log('[ROUTE] META', { url: req.originalUrl, id, configId, m3uUrl: m3uUrl ? '[ok]' : null });

    const m3uHash = getM3uHash(m3uUrl);
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
});

router.get('/:configId/stream/:type/:id.json', async (req, res) => {
  try {
    const id = String(req.params.id).replace(/\.json$/, '');
    const configId = req.params.configId || extractConfigIdFromUrl(req);
    const m3uUrl = await resolveM3uUrl(configId);
    console.log('[ROUTE] STREAM', { url: req.originalUrl, id, configId, m3uUrl: m3uUrl ? '[ok]' : null });

    const m3uHash = getM3uHash(m3uUrl);
    const kvKey = `stream:${m3uHash}:${id}`;
    let kvCached = await kvGetJsonTTL(kvKey);

    if (kvCached) {
      console.log('[STREAM] Usando caché KV:', kvCached);
      const enriched = await enrichWithExtra(kvCached, configId, m3uUrl);
      return res.json(enriched);
    }

    let result = await handleStreamInternal({ id, m3uUrl, configId });
    const enriched = await enrichWithExtra(result, configId, m3uUrl);
    await kvSetJsonTTL(kvKey, enriched);
    res.json(enriched);
  } catch (e) {
    console.error('[STREAM] route error:', e.message);
    res.status(200).json({ streams: [] });
  }
});

// -------------------- Config web --------------------
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
        <p>Enter the URL of your M3U playlist and optionally extra websites separated by ; or |:</p>
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

    const urlRegex = /^https?:\/\/[^\s/$.?#].[^\s]*$/;
    const extraWebsList = extraWebs ? extraWebs.split(/[;|,\n]+/).map(s => s.trim()).filter(s => urlRegex.test(s)) : [];

    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const head = await fetch(m3uUrl, { method: 'HEAD', signal: controller.signal });
      clearTimeout(t);
      if (!head.ok) throw new Error(`HEAD ${head.status}`);
    } catch {
      const r = await fetch(m3uUrl, { method: 'GET' });
      if (!r.ok) throw new Error('La URL M3U no es accesible');
      const text = await r.text();
      if (!text.includes('#EXTINF')) throw new Error('No es un archivo M3U válido');
    }

    const configId = uuidv4();
    await kvSetJson(configId, { m3uUrl, extraWebs: extraWebsList.join(';') });

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

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Heimdallr listening on http://localhost:${port}`));
}
