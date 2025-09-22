// api/handlers/meta.js
'use strict';

const NodeCache = require('node-cache');
const { getChannel } = require('../../src/db');
const { kvGetJsonTTL, kvSetJsonTTLIfChanged } = require('../kv');
const { getM3uHash, extractConfigIdFromUrl } = require('../utils');
const { CACHE_TTL } = require('../../src/config');
const { resolveM3uUrl } = require('../resolve');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

async function handleMeta(req) {
  const logPrefix = '[META]';
  const { id } = req.params;
  const configId = req.params.configId || extractConfigIdFromUrl(req);
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

  // 🚀 Solo escribir en KV si hay cambios
  const kvKey = `meta:${m3uHash}:${channelId}`;
  await kvSetJsonTTLIfChanged(kvKey, resp, 24 * 3600);

  console.log(logPrefix, `meta para ${channelId}: ${ch.name}`);
  return resp;
}

module.exports = { handleMeta };
