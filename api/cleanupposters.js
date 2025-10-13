// api/cleanupposters.js
'use strict';

const { kvGetJsonTTL, kvSetJsonTTLIfChanged } = require('./kv');
const { del } = require('@vercel/blob');
const { DateTime } = require('luxon');

async function cleanupPosters() {
  const today = DateTime.now().setZone('Europe/Madrid');
  const tomorrow = today.plus({ days: 1 });
  const isLastDayOfMonth = tomorrow.month !== today.month;

  if (!isLastDayOfMonth) {
    console.log('[Cleanup] No es fin de mes. Abortando.');
    return { executed: false, deleted: [] };
  }

  console.log('[Cleanup] Hoy es el último día del mes. Procediendo...');

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

  const deleted = [];

  for (const name of toDelete) {
    try {
      await del(name, { token: process.env.BLOB_READ_WRITE_TOKEN });
      console.info(`[Cleanup] Borrado: ${name}`);
      deleted.push(name);
    } catch (err) {
      console.warn(`[Cleanup] Error borrando ${name}:`, err.message);
      keep.push(name); // lo conservamos si falló
    }
  }

  await kvSetJsonTTLIfChanged(indexKey, keep, 30 * 24 * 3600);

  return { executed: true, deleted };
}

module.exports = async function handler(req, res) {
  try {
    const { executed, deleted } = await cleanupPosters();

    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (!executed) {
      return res.end(`<html><body><h2>La limpieza ha sido omitida según las instrucciones del administrador</h2></body></html>`);
    }

    const htmlList = deleted.length
      ? `<ul>${deleted.map(name => `<li>${name}</li>`).join('')}</ul>`
      : `<p>No se ha eliminado ningún póster.</p>`;

    return res.end(`<html><body><h2>Limpieza completada</h2>${htmlList}</body></html>`);
  } catch (err) {
    console.error('[Cleanup] Error general:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<html><body><h2>Error en limpieza</h2><pre>${err.message}</pre></body></html>`);
  }
};
