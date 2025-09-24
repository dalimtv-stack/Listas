// src/cron/cleanup-posters.js
'use strict';

const { kvListKeys, kvGetJson, kvDelete } = require('../../api/kv');

async function cleanupOldPosters({ maxAgeDays = 3 }) {
  const now = Date.now();
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;

  const keys = await kvListKeys('poster:');
  let deleted = 0;

  for (const key of keys) {
    const value = await kvGetJson(key);
    const isFallback = typeof value === 'string' && value.includes('placehold.co');
    const createdAt = value?.createdAt || 0;

    if (isFallback || createdAt < cutoff) {
      await kvDelete(key);
      deleted++;
    }
  }

  console.log(JSON.stringify({
    level: 'info',
    scope: 'cleanup-posters',
    deleted,
    total: keys.length,
    status: 'done'
  }));
}
