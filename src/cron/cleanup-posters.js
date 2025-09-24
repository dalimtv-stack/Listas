// src/cron/cleanup-posters.js
'use strict';

const { kvListKeys, kvGetJson, kvDelete, kvSetJson } = require('../../api/kv');

async function cleanupOldPosters({ maxAgeDays = 3 } = {}) {
  const now = Date.now();
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;

  const keys = await kvListKeys('poster:');
  let deleted = 0;
  let fallbackCount = 0;
  let expiredCount = 0;

  for (const key of keys) {
    const value = await kvGetJson(key);
    const isFallback = typeof value === 'string'
      ? value.includes('placehold.co')
      : value?.url?.includes('placehold.co');

    const createdAt = value?.createdAt || 0;
    const isExpired = createdAt < cutoff;

    if (isFallback || isExpired) {
      await kvDelete(key);
      deleted++;
      if (isFallback) fallbackCount++;
      if (isExpired) expiredCount++;
    }
  }

  const summary = {
    deleted,
    fallbackCount,
    expiredCount,
    total: keys.length,
    timestamp: now
  };

  await kvSetJson('poster:cleanup:last', summary);

  return { ...summary, status: 'done' };
}

module.exports = { cleanupOldPosters };
