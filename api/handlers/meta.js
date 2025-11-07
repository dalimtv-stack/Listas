// api/handlers/meta.js
'use strict';

const NodeCache = require('node-cache');
const { getChannel } = require('../../src/db');
const { kvGetJsonTTL, kvSetJsonTTLIfChanged } = require('../kv');
const { normalizeCatalogName, getM3uHash, extractConfigIdFromUrl } = require('../utils');
const { CACHE_TTL } = require('../../src/config');
const { resolveM3uUrl } = require('../resolve');

// --- Import de eventos ---
const { getMeta: getEventosMeta } = require('../../src/eventos/meta-events');

const cache = new NodeCache({ stdTTL: CACHE_TTL });
const xml2js = require('xml2js');
const EPG_URL = 'https://raw.githubusercontent.com/dalimtv-stack/miEPG/main/miEPG.xml';

async function obtenerEPGDescripcion(canalId) {
  try {
    const res = await fetch(EPG_URL);
    const xml = await res.text();
    const parsed = await xml2js.parseStringPromise(xml, { mergeAttrs: true });
    const programas = parsed.tv.programme;

    const eventos = programas
      .filter(p => p.channel?.[0] === canalId)
      .map(p => ({
        start: p.start?.[0],
        title: p.title?.[0]?._ || '',
      }))
      .sort((a, b) => a.start.localeCompare(b.start));

    const ahora = new Date();
    const proximos = eventos.filter(e => {
      const fecha = parseFechaXMLTV(e.start);
      return fecha > ahora;
    }).slice(0, 3);

    return proximos.map(e => {
      const hora = e.start.slice(8, 12).replace(/(\d{2})(\d{2})/, '$1:$2');
      return `${hora} - ${e.title}`;
    }).join('\n');
  } catch (err) {
    console.warn('[EPG] Error al obtener EPG:', err.message);
    return 'Sin programación disponible.';
  }
}

function parseFechaXMLTV(str) {
  const clean = str.split(' ')[0];
  const año = clean.slice(0, 4);
  const mes = clean.slice(4, 6);
  const dia = clean.slice(6, 8);
  const hora = clean.slice(8, 10);
  const min = clean.slice(10, 12);
  const seg = clean.slice(12, 14);
  return new Date(`${año}-${mes}-${dia}T${hora}:${min}:${seg}Z`);
}

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
  
  const cleanName = normalizeCatalogName (ch.name);

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
