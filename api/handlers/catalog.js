// api/handlers/catalog.js
'use strict';

const NodeCache = require('node-cache');
const crypto = require('crypto');
const { getChannels } = require('../../src/db');
const { kvGet, kvSet, kvGetJsonTTL, kvSetJsonTTLIfChanged } = require('../kv');
const { normalizeCatalogName, getM3uHash, parseCatalogRest, extractConfigIdFromUrl } = require('../utils');
const { CACHE_TTL, ADDON_PREFIX, FORCE_REFRESH_GENRES } = require('../../src/config');
const { resolveM3uUrl } = require('../resolve');
const { getCatalog: getEventosCatalog } = require('../../src/eventos/catalog-events');
const { actualizarEPGSiCaducado } = require('../epg'); // ✅ añadido

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// ✅ función auxiliar para actualizar EPG en segundo plano
function actualizarEPGEnSegundoPlano(channelIds) {
  for (const canalId of channelIds) {
    setTimeout(async () => {
      try {
        const clave = `epg:${canalId}`;
        const actual = await kvGet(clave);
        if (actual === null || actual === undefined) {
          console.log('[EPG] TTL caducado o datos inválidos, actualizando:', canalId);
          await actualizarEPGSiCaducado(canalId);
        }
      } catch (err) {
        console.warn('[EPG] Error al actualizar', canalId, err.message);
      }
    }, 0); // no bloquea
  }
}

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
        c.additional_streams.forEach(s => s?.group_title && seenGenres.add(s.group_title));
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

    const existingGenres = await kvGetJsonTTL(`genres:${configId}`) || [];

    if (!genreList.length) {
      console.warn(`[GENRES] Lista vacía detectada, se evita sobrescribir géneros existentes para ${configId}`);
      return;
    }

    const nowStr = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });

    if (!lastHash || lastHash !== currentHash || FORCE_REFRESH_GENRES) {
      await kvSetJsonTTLIfChanged(`genres:${configId}`, genreList, 24 * 3600);
      await kvSet(lastHashKey, currentHash);
      await kvSet(lastUpdateKey, nowStr);
      console.log(`[GENRES] actualizados: ${genreList.length} géneros (Otros=${orphanCount})`);
      require('../../src/config').FORCE_REFRESH_GENRES = false;
      console.log(`[GENRES] Flag FORCE_REFRESH_GENRES desactivado tras actualización para ${configId}`);
    } else {
      const sameList = existingGenres.length === genreList.length &&
                       existingGenres.every((g, i) => g === genreList[i]);

      if (!sameList) {
        await kvSetJsonTTLIfChanged(`genres:${configId}`, genreList, 24 * 3600);
        await kvSet(lastUpdateKey, nowStr);
        console.log(`[GENRES] lista de géneros actualizada sin cambio de hash`);
      } else if (!lastUpdate) {
        await kvSet(lastUpdateKey, nowStr);
        console.log(`[GENRES] timestamp inicial registrado: ${nowStr}`);
      } else {
        console.log(`[GENRES] géneros sin cambios, usando caché: ${genreList.length}`);
      }
    }
  } catch (e) {
    console.error('[GENRES] error al extraer:', e.message);
  }
}

async function handleCatalog(req) {
  const logPrefix = '[CATALOG]';
  const { type, rest } = req.params;
  const { id, extra: extraFromRest } = parseCatalogRest(rest || '');
  const configId = req.params.configId || extractConfigIdFromUrl(req);
  const extra = {
    search: req.query.search || extraFromRest.search || '',
    genre: req.query.genre || extraFromRest.genre || ''
  };

  console.log('[CATALOG] parsed', { type, id, configId, extra });

  if (type === 'tv' && id.startsWith('Heimdallr_eventos')) {
    console.log(logPrefix, `Procesando catálogo de eventos para configId: ${configId}, genre: ${extra.genre || 'ninguno'}`);
    const metas = await getEventosCatalog(configId, extra.genre);
    console.log(logPrefix, `catálogo de eventos generado: ${metas.length}`);
    return { metas };
  }

  const m3uUrl = await resolveM3uUrl(configId);
  if (type !== 'tv' || !m3uUrl) {
    console.log(logPrefix, type !== 'tv' ? `type no soportado: ${type}` : 'm3uUrl no resuelta');
    return { metas: [] };
  }

  const currentM3uHash = await getM3uHash(m3uUrl);
  const storedM3uHashKey = `m3u_hash:${configId}`;
  const storedM3uHash = await kvGet(storedM3uHashKey);

  let channels;
  if (!storedM3uHash || storedM3uHash !== currentM3uHash || FORCE_REFRESH_GENRES) {
    console.log(logPrefix, `M3U hash cambiado o FORCE_REFRESH_GENRES activo, recargando canales y géneros para ${configId}`);
    channels = await getChannels({ m3uUrl });
    await kvSet(storedM3uHashKey, currentM3uHash);
    await extractAndStoreGenresIfChanged(channels, configId);
  } else {
    channels = await getChannels({ m3uUrl });
    console.log(logPrefix, `M3U sin cambios, canales cargados: ${channels.length}`);
    actualizarEPGEnSegundoPlano(channels.map(c => c.id)); // ✅ añadido
  }

  const m3uHash = currentM3uHash;
  const cacheKey = `catalog_${m3uHash}_${extra.genre || ''}_${extra.search || ''}`;
  const cached = cache.get(cacheKey);
  if (cached && !FORCE_REFRESH_GENRES) {
    console.log(logPrefix, 'cache HIT y M3U sin cambios', cacheKey);
    return cached;
  }

  let filtered = channels;

  if (extra.search) {
    const q = String(extra.search).toLowerCase();
    filtered = filtered.filter(c => normalizeCatalogName(c.name).toLowerCase().includes(q));
    console.log(logPrefix, `aplicado search="${q}", tras filtro: ${filtered.length}`);
  }

  if (extra.genre) {
    const g = String(extra.genre);
    filtered = channels.filter(c => {
      const genres = Array.isArray(c.extra_genres) ? c.extra_genres : [];
      return g === 'Otros'
        ? !genres.some(gen => gen !== 'General')
        : genres.includes(g);
    });
    console.log(logPrefix, `aplicado genre="${g}", tras filtro: ${filtered.length}`);
  }
  
  const metas = filtered.map(c => {
    console.log(`[CATALOG] Canal procesado - ID: ${c.id}`);  // Log para el ID de cada canal
    return {
      id: `${ADDON_PREFIX}_${configId}_${c.id}`,
      type: 'tv',
      name: normalizeCatalogName(c.name),
      poster: c.logo_url,
      background: c.logo_url || null
    };
  });

  const resp = { metas };
  cache.set(cacheKey, resp);

  const kvKey = `catalog:${m3uHash}:${extra.genre || ''}:${extra.search || ''}`;
  await kvSetJsonTTLIfChanged(kvKey, resp, 24 * 3600);
  console.log(logPrefix, `respuesta metas: ${metas.length}`);

  return resp;
}

module.exports = { handleCatalog, extractAndStoreGenresIfChanged };
