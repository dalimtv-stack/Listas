// api/cleanupposters.js
'use strict';

const { list, del } = require('@vercel/blob');
const { DateTime } = require('luxon');

async function cleanupPosters() {
  const today = DateTime.now().setZone('Europe/Madrid');
  const cutoff = today.minus({ days: 3 }).toFormat('yyyyMMdd');

  console.info(`[Cleanup] Borrando imágenes anteriores a ${cutoff} o sin fecha`);

  const { blobs } = await list({ prefix: 'posters/' });

  for (const blob of blobs) {
    const name = blob.pathname; // ej: posters/F4411875_20251001_20_00.png
    const match = name.match(/_(\d{8})_/);

    let shouldDelete = false;

    if (match) {
      const fileDate = match[1]; // YYYYMMDD
      if (fileDate < cutoff) {
        shouldDelete = true;
      }
    } else {
      // no tiene fecha en el nombre
      shouldDelete = true;
    }

    if (shouldDelete) {
      try {
        await del(name, { token: process.env.BLOB_READ_WRITE_TOKEN });
        console.info(`[Cleanup] Borrado: ${name}`);
      } catch (err) {
        console.warn(`[Cleanup] Error borrando ${name}:`, err.message);
      }
    }
  }
}

module.exports = async function handler(req, res) {
  try {
    await cleanupPosters();
    res.status(200).json({ message: 'Cleanup completado' });
  } catch (err) {
    console.error('[Cleanup] Error general:', err);
    res.status(500).json({ error: err.message });
  }
};
