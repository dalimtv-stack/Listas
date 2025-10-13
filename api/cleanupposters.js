// api/cleanupposters.js
const { kvGetJsonTTL, kvSetJsonTTLIfChanged, kvDelete } = require('./kv');
const { del } = require('@vercel/blob');
const { DateTime } = require('luxon');

async function cleanupPosters() {
  const today = DateTime.now().setZone('Europe/Madrid');

  // 🧱 Solo ejecuta si es el último día del mes
  const tomorrow = today.plus({ days: 1 });
  if (tomorrow.month !== today.month) {
    console.log('[Cleanup] Hoy es el último día del mes. Procediendo...');
  } else {
    console.log('[Cleanup] No es fin de mes. Abortando.');
    return;
  }

  const cutoff = today.minus({ days: 3 }).toFormat('yyyyMMdd');
  const indexKey = 'posters:index';
  const posterList = await kvGetJsonTTL(indexKey) || [];

  const keep = [];
  const toDelete = [];

  for (const name of posterList) {
    const match = name.match(/_(\d{8})_/);
    if (match) {
      const fileDate = match[1];
      if (fileDate < cutoff) {
        toDelete.push(name);
      } else {
        keep.push(name);
      }
    } else {
      toDelete.push(name); // sin fecha → eliminar
    }
  }

  for (const name of toDelete) {
    try {
      await del(name, { token: process.env.BLOB_READ_WRITE_TOKEN });
      console.info(`[Cleanup] Borrado: ${name}`);
    } catch (err) {
      console.warn(`[Cleanup] Error borrando ${name}:`, err.message);
      keep.push(name); // lo conservamos si falló
    }
  }

  // 🧼 Actualiza el índice
  await kvSetJsonTTLIfChanged(indexKey, keep, 30 * 24 * 3600); // 30 días
}
