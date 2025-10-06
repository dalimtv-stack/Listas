// api/handlers/meta.js
'use strict';

const NodeCache = require('node-cache');
const { getChannel } = require('../../src/db');
const { kvGetJsonTTL, kvSetJsonTTLIfChanged } = require('../kv');
const { getM3uHash, extractConfigIdFromUrl } = require('../utils');
const { CACHE_TTL } = require('../../src/config');
const { resolveM3uUrl } = require('../resolve');
const { getMeta: getEventosMeta } = require('../../src/eventos/meta-events');
const { transformarTexto, extraerYLimpiarCalidad } = require('../../src/eventos/stream-events');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

async function handleMeta(req) {
  const logPrefix = '[META]';
  const { id } = req.params;
  const configId = req.params.configId || extractConfigIdFromUrl(req);

  if (id.startsWith('Heimdallr_evt')) {
    const meta = await getEventosMeta(id, configId);
    console.log(logPrefix, `meta de evento generado: ${meta ? meta.name : 'null'}`);
    return { meta };
  }

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

  const { calidadDetectada } = extraerYLimpiarCalidad(ch.name);
  const categoria = ch.group_title && ch.group_title !== 'General' ? transformarTexto(ch.group_title) : transformarTexto(ch.extra_genres?.[0] || 'Otros');
  const formato = ch.acestream_id ? 'Acestream' : ch.m3u8_url ? 'M3U8' : ch.stream_url ? 'Directo' : 'Browser';
  const audioMatch = ch.name.match(/\(multiaudio\)|[\[](AR|PT|ES|EN)[^\]]*]/i);
  const audio = audioMatch ? (audioMatch[1] || 'Multiaudio') : 'Multiaudio';
  const proveedor = 'NEW ERA';
  const description = `Formato: ${formato}\nCategoria: ${categoria}\nCalidad: 🖥️ ${calidadDetectada}\nAudio: 📡 ${audio}\nProveedor: 🏴‍☠️${proveedor}🏴‍☠️`;

  const meta = {
    id,
    type: 'tv',
    name: transformarTexto(ch.name),
    poster: ch.logo_url || `https://dummyimage.com/300x450/000000/ffffff.png&text=${encodeURIComponent(ch.name)}`,
    background: ch.logo_url,
    description
  };

  const resp = { meta };
  cache.set(cacheKey, resp);

  const kvKey = `meta:${m3uHash}:${channelId}`;
  await kvSetJsonTTLIfChanged(kvKey, resp, 24 * 3600);

  console.log(logPrefix, `meta para ${channelId}: ${ch.name}`);
  return resp;
}

module.exports = { handleMeta };
