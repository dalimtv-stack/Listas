// api/index.js
'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const NodeCache = require('node-cache');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
require('dotenv').config();

// Primero, módulos que podrían depender indirectamente de index.js
const { getChannels, getChannel } = require('../src/db');
const { scrapeExtraWebs } = require('./scraper');

// Ahora, importar helpers KV desde api/kv.js (después de db y scraper)
const {
  kvGet,
  kvSet,
  kvGetJson,
  kvSetJson,
  kvGetJsonTTL,
  kvSetJsonTTL
} = require('./kv.js');

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
const DEFAULT_M3U_URL =
  process.env.DEFAULT_M3U_URL ||
  'https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u';

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
async function getLastUpdateString(configId) {
  try {
    const raw = await kvGet(`last_update:${configId}`);
    if (raw && typeof raw === 'string' && raw.trim()) return raw.trim();
  } catch {}
  return 'Sin actualizar aún';
}

function extractConfigIdFromUrl(req) {
  const m = req.url.match(/^\/([^/]+)\/(manifest\.json|catalog|meta|stream)\b/);
  if (m && m[1]) return m[1];
  return DEFAULT_CONFIG_ID;
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
  let lastUpdateStr = await getLastUpdateString(configId);

  let currentM3u = '';
  let currentExtraWebs = '';
  try {
    const cfg = await kvGetJson(configId);
    if (cfg) {
      if (cfg.m3uUrl) currentM3u = cfg.m3uUrl;
      if (cfg.extraWebs) currentExtraWebs = cfg.extraWebs;
    }
  } catch {}

  try {
    const genresKV = await kvGetJsonTTL(`genres:${configId}`);
    if (Array.isArray(genresKV) && genresKV.length) genreOptions = genresKV;
  } catch {}

  lastUpdateStr = await getLastUpdateString(configId);

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
  if (type !== 'tv' || !m3uUrl) return { metas: [] };

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
    const configId = id.startsWith(`${CATALOG_PREFIX}_`) ? id.split('_')[1] : DEFAULT_CONFIG_ID;
    await kvSetJsonTTL(`genres:${configId}`, genreList);
  } catch (e) {
    console.error('[CATALOG] error al extraer géneros:', e.message);
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

  const configId = id.startsWith(`${CATALOG_PREFIX}_`) ? id.split('_')[1] : DEFAULT_CONFIG_ID;
  const metas = filtered.map(c => ({
    id: `${ADDON_PREFIX}_${configId}_${c.id}`,
    type: 'tv',
    name: c.name,
    poster: c.logo_url
  }));

  return { metas };
}

async function handleMeta({ id, m3uUrl }) {
  if (!id || !m3uUrl) {
    console.warn('[META] Parámetros inválidos:', { id, m3uUrl });
    return { meta: null };
  }

  const parts = id.split('_');
  const configId = parts[1];
  const channelId = parts.slice(2).join('_');

  const ch = await getChannel(m3uUrl, channelId);

  if (!ch) {
    console.warn(`[META] Canal no encontrado para id: ${channelId}`);
    return { meta: null };
  }

  return {
    meta: {
      id,
      name: ch.name || id,
      logo: ch.logo || '',
      background: ch.background || '',
      description: ch.description || '',
      type: ch.type || 'tv',
      posterShape: 'landscape'
    }
  };
}

async function handleStream({ id, m3uUrl, configId }) {
  if (!m3uUrl) return { streams: [], chName: '' };

  const parts = id.split('_');
  const channelId = parts.slice(2).join('_');

  const ch = await getChannel(m3uUrl, channelId);
  if (!ch) {
    console.warn(`[STREAM] Canal no encontrado para id: ${channelId}`);
    return { streams: [], chName: '' };
  }

  const chName = ch.name;
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

  const extraStreams = await scrapeExtraWebs(ch);
  extraStreams.forEach(url => {
    streams.push({
      title: `${ch.name} (extra)`,
      url,
      name: ch.group_title || 'extra'
    });
  });

  return { streams, chName };
}

// -------------------- Extraer y guardar géneros solo si cambia la M3U --------------------
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
        await kvSetJsonTTL(`genres:${configId}`, genreList);
        await kvSet(lastHashKey, currentHash);
        await kvSet(lastUpdateKey, nowStr);
        console.log(`[GENRES] actualizados: ${genreList.length} géneros (Otros=${orphanCount})`);
      } else if (!lastUpdate) {
        await kvSet(lastUpdateKey, nowStr);
        console.log(`[GENRES] timestamp inicial registrado: ${nowStr}`);
      }
    }
  } catch (e) {
    console.error('[GENRES] error al extraer:', e.message);
  }
}

// -------------------- Rutas MANIFEST --------------------
router.get('/manifest.json', async (req, res) => {
  const manifest = await buildManifest(DEFAULT_CONFIG_ID);
  res.json(manifest);
});
router.get('/:configId/manifest.json', async (req, res) => {
  const manifest = await buildManifest(req.params.configId);
  res.json(manifest);
});

// -------------------- Rutas de catálogo --------------------
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
      search: req.query.search || extraFromRest.search || '',
      genre: req.query.genre || extraFromRest.genre || ''
    };

    console.log('[CATALOG] parsed', { type, id, configId, extra, m3uUrl: m3uUrl ? '[ok]' : null });

    const m3uHash = crypto.createHash('md5').update(m3uUrl || '').digest('hex');
    const kvKey = `catalog:${m3uHash}:${extra.genre || ''}:${extra.search || ''}`;

    const kvCached = await kvGetJsonTTL(kvKey);
    if (kvCached) {
      console.log('[CATALOG] KV HIT', kvKey);
      try {
        const channels = await getChannels({ m3uUrl });
        await extractAndStoreGenresIfChanged(channels, configId);
      } catch (e) {
        console.error('[CATALOG] error al actualizar géneros tras KV HIT:', e.message);
      }
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
// -------------------- Rutas META y STREAM --------------------
async function metaRoute(req, res) {
  try {
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
    await kvSetJson(configId, { m3uUrl, extraWebs });

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

// -------------------- Arranque local --------------------
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Heimdallr listening on http://localhost:${port}`));
}
