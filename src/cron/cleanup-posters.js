// src/cron/cleanup-posters.js
'use strict';

const { kvListKeys, kvGetJson, kvDelete } = require('../../api/kv');

async function cleanupOldPosters({ maxAgeDays = 3 } = {}) {
  const now = Date.now();
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;

  const keys = await kvListKeys('poster:');
  let deleted = 0;
  let fallbackCount = 0;
  let expiredCount = 0;

  for (const key of keys) {
    const value = await kvGetJson(key);

    // Detecta si es fallback
    const isFallback = typeof value === 'string'
      ? value.includes('placehold.co')
      : value?.url?.includes('placehold.co');

    // Detecta si está vencido
    const createdAt = value?.createdAt || 0;
    const isExpired = createdAt < cutoff;

    if (isFallback || isExpired) {
      await kvDelete(key);
      deleted++;
      if (isFallback) fallbackCount++;
      if (isExpired) expiredCount++;
    }
  }

  console.log(JSON.stringify({
    level: 'info',
    scope: 'cleanup-posters',
    deleted,
    fallbackCount,
    expiredCount,
    total: keys.length,
    status: 'done'
  }));
}

module.exports = { cleanupOldPosters };
