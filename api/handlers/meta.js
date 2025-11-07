// api/handlers/meta.js
'use strict';

const NodeCache = require('node-cache');
const { getChannel } = require('../../src/db');
const { kvSetJsonTTLIfChanged } = require('../kv');
const { normalizeCatalogName, getM3uHash, extractConfigIdFromUrl } = require('../utils');
const { CACHE_TTL } = require('../../src/config');
const { resolveM3uUrl } = require('../resolve');

// --- Import de eventos ---
const { getMeta: getEventosMeta } = require('../../src/eventos/meta-events');

// --- EPG por canal desde KV ---
const { actualizarEPGSiCaducado, parseFechaXMLTV, getEventoActualDesdeKV } = require('../epg');

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
  const { actual, siguientes } = await getEventoActualDesdeKV(channelId);

  let epgDescripcion = 'Sin programación disponible.';
  
  if (actual) {
    const inicio = parseFechaXMLTV(actual.start);
    const fin = parseFechaXMLTV(actual.stop);
    const hora = d => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  
    epgDescripcion =
      `${hora(inicio)} - ${hora(fin)}\n` +
      `•  ${actual.title}  •\n\n` +
      `${actual.desc}`;
  
    if (siguientes.length) {
      epgDescripcion += '\n\nPróximos:\n';
      for (const e of siguientes) {
        const h = parseFechaXMLTV(e.start);
        epgDescripcion += `⏭ ${hora(h)}\n• ${e.title}  •\n`;
      }
      epgDescripcion = epgDescripcion.trimEnd();
    }
  }

  const resp = {
    meta: {
      id,
      type: 'tv',
      name: cleanName,
      poster: ch.logo_url,
      background: ch.logo_url,
      description: epgDescripcion
    }
  };

  cache.set(cacheKey, resp);

  // 🚀 Solo escribir en KV si hay cambios
  const kvKey = `meta:${m3uHash}:${channelId}`;
  await kvSetJsonTTLIfChanged(kvKey, resp, 24 * 3600);

  console.log(logPrefix, `meta para ${channelId}: ${ch.name}`);
  return resp;
}

module.exports = { handleMeta };
