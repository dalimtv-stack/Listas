// api/handlers/meta.js
'use strict';
const NodeCache = require('node-cache');
const { getChannel } = require('../../src/db');
const { normalizeCatalogName, getM3uHash, extractConfigIdFromUrl } = require('../utils');
const { CACHE_TTL } = require('../../src/config');
const { resolveM3uUrl } = require('../resolve');
// --- Import de eventos ---
const { getMeta: getEventosMeta } = require('../../src/eventos/meta-events');
// --- EPG por canal desde KV ---
const { actualizarEPGSiCaducado, parseFechaXMLTV, getEventoActualDesdeKV } = require('../epg');
// --- KV helpers ---
const { kvGetJsonTTL, kvSetJsonTTLIfChanged } = require('../kv');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

async function handleMeta(req) {
  const logPrefix = '[META]';
  const { id } = req.params;
  const configId = req.params.configId || extractConfigIdFromUrl(req);
  
  // --- Rama de eventos ---
  if (id.startsWith('Heimdallr_evt')) {
    const meta = await getEventosMeta(id, configId);
    console.log(logPrefix, `meta de evento generado: ${meta ? meta.name : 'null'}`);
    return { meta };
  }
  
  // --- Resto: canales IPTV ---
  const m3uUrl = await resolveM3uUrl(configId);
  console.log('[ROUTE] META', { url: req.originalUrl, id, configId, m3uUrl: m3uUrl ? '[ok]' : null });
  if (!m3uUrl) {
    console.log(logPrefix, 'm3uUrl no resuelta');
    return { meta: null };
  }
  
  const m3uHash = await getM3uHash(m3uUrl);
  const channelId = id.split('_').slice(2).join('_');
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
  
  const cleanName = normalizeCatalogName(ch.name);
  
  // --- EPG desde KV ---
  await actualizarEPGSiCaducado(channelId);
  const { actual, siguientes, logo: logoEPG } = await getEventoActualDesdeKV(channelId);
  
  // --- META ESTÁTICA DESDE KV (48h) ---
  const claveMetaEstatica = `meta:${m3uHash}:${channelId}`;
  const metaEstaticaKV = await kvGetJsonTTL(claveMetaEstatica);
  
  let poster = ch.poster || ch.logo_url;
  let background = ch.background || ch.logo_url;
  let logoEstatico = undefined;
  
  if (metaEstaticaKV?.meta) {
    console.log(logPrefix, 'meta estática desde KV (48h)');
    const m = metaEstaticaKV.meta;
    poster = m.poster || poster;
    background = m.background || background;
    logoEstatico = m.logo;
  } else {
    // Guardar meta estática en KV (solo si no existe o ha caducado)
    const metaEstatica = {
      id,
      type: 'tv',
      name: cleanName,
      poster,
      background,
      logo: logoEPG || undefined  // ← LOGO DEL EPG
    };
    const ttl48h = 48 * 3600; // 48 horas en segundos
    await kvSetJsonTTLIfChanged(claveMetaEstatica, metaEstatica, ttl48h);
    console.log(logPrefix, 'meta estática guardada en KV (48h)');
  }
  
  // --- Construcción de descripción dinámica ---
  const titulo = actual?.title;
  const descripcion = actual?.desc;
  let epgDescripcion = 'Sin programación disponible.';
  
  if (titulo && descripcion && titulo !== 'Sin información') {
    const inicio = parseFechaXMLTV(actual.start);
    const fin = parseFechaXMLTV(actual.stop);
    const hora = d => isNaN(d) ? '??:??' : d.toLocaleTimeString('es-ES', { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: 'Europe/Madrid'  // ← Forzar zona horaria
    });
    epgDescripcion =
      `${hora(inicio)} - ${hora(fin)}\n` +
      `• ${titulo} •\n\n` +
      `${descripcion}`.trim();
    if (siguientes.length) {
      epgDescripcion += '\n\nPróximos:\n';
      for (const e of siguientes) {
        const h = parseFechaXMLTV(e.start);
        epgDescripcion += `${hora(h)}: ${e.title || 'Sin título'}\n`;
      }
      epgDescripcion = epgDescripcion.trimEnd();
    }
  }
  
  // 🔍 Log de depuración
  console.log('[META] evento actual:', actual);
  console.log('[META] descripción generada:\n', epgDescripcion);
  
  const resp = {
    meta: {
      id,
      type: 'tv',
      name: cleanName,
      poster,
      background,
      votes: '10',
      "genres": ["Action", "Adventure", "Fantasy"],
      year: '16',
      description: epgDescripcion,
      logo: logoEstatico || logoEPG || undefined  // ← Prioridad: KV > EPG
    }
  };
  
  // TTL dinámico: expira al terminar el evento actual (mínimo 30s)
  let ttlSegundos = CACHE_TTL;
  if (actual?.stop) {
    const finTS = parseFechaXMLTV(actual.stop).getTime();
    const ahoraTS = Date.now();
    const restanteMs = Math.max(0, finTS - ahoraTS);
    ttlSegundos = Math.max(30, Math.floor(restanteMs / 1000));
  }
  cache.set(cacheKey, resp, ttlSegundos);
  
  console.log(logPrefix, `meta para ${channelId}: ${ch.name}`);
  return resp;
}

module.exports = { handleMeta };
