'use strict';

const NodeCache = require('node-cache');
const { kvGet, kvSetJsonTTLIfChanged } = require('../kv');
const { normalizeCatalogName, extractConfigIdFromUrl } = require('../utils');
const { CACHE_TTL, ADDON_PREFIX } = require('../../src/config');
const { resolveM3uUrl } = require('../resolve');
const { getChannels } = require('../../src/db');
const { getStreams: getEventosStreams } = require('../../src/eventos/stream-events');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

/**
 * Enriquecer un stream con extras (si aplica)
 */
function enrichWithExtra(baseObj, channel) {
  if (Array.isArray(channel.additional_streams)) {
    baseObj.behaviorHints = baseObj.behaviorHints || {};
    baseObj.behaviorHints.group = channel.additional_streams.map(s => ({
      name: s.group_title || '',
      url: s.url
    }));
  }
  return baseObj;
}

/**
 * Handler principal de streams
 */
async function handleStream(req) {
  const logPrefix = '[STREAM]';
  const { type, id } = req.params;
  const configId = req.params.configId || extractConfigIdFromUrl(req);

  console.log(logPrefix, 'parsed', { type, id, configId });

  // --- Rama de eventos ---
  if (type === 'tv' && id.startsWith('eventos_')) {
    const { streams, chName } = await getEventosStreams(id, configId);
    console.log(logPrefix, `streams de evento generados: ${streams.length}`);
    return { streams, chName };
  }

  // --- Rama IPTV normal ---
  const m3uUrl = await resolveM3uUrl(configId);
  if (type !== 'tv' || !m3uUrl) {
    console.log(logPrefix, type !== 'tv' ? `type no soportado: ${type}` : 'm3uUrl no resuelta');
    return { streams: [] };
  }

  const cacheKey = `stream_${configId}_${id}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(logPrefix, 'cache HIT', cacheKey);
    return cached;
  }

  const channels = await getChannels({ m3uUrl });
  const channel = channels.find(c => `${ADDON_PREFIX}_${configId}_${c.id}` === id);

  if (!channel) {
    console.warn(logPrefix, `canal no encontrado para id=${id}`);
    return { streams: [] };
  }

  const baseStream = {
    name: normalizeCatalogName(channel.name),
    title: channel.name,
    url: channel.url,
    behaviorHints: { notWebReady: true }
  };

  const enriched = enrichWithExtra(baseStream, channel);
  const resp = { streams: [enriched] };

  cache.set(cacheKey, resp);
  await kvSetJsonTTLIfChanged(cacheKey, resp, 24 * 3600);

  console.log(logPrefix, `stream generado para ${id}`);
  return resp;
}

module.exports = { handleStream, enrichWithExtra };
