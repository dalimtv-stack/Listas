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

function renderHtml({ executed, deleted }) {
  const title = executed
    ? 'Limpieza completada'
    : 'Limpieza no ejecutada';

  const message = executed
    ? (deleted.length
        ? `<p>Se han eliminado los siguientes pósters:</p><ul>${deleted.map(name => `<li>${name}</li>`).join('')}</ul>`
        : `<p>No se ha eliminado ningún póster.</p>`)
    : `<p>No se ha realizado la limpieza por decisión del administrador.</p>`;

  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        max-width: 90%;
        margin: 1rem auto;
        padding: 0 0.5rem;
        line-height: 1.5;
        color: #333;
      }
      h1 {
        font-size: 1.8rem;
        text-align: center;
        margin-bottom: 1rem;
      }
      p {
        font-size: 1rem;
        margin-bottom: 0.8rem;
      }
      ul {
        padding-left: 1.2rem;
      }
      li {
        margin-bottom: 0.4rem;
        font-family: monospace;
        font-size: 0.95rem;
      }
      @media (min-width: 600px) {
        body {
          max-width: 600px;
        }
        h1 {
          font-size: 2rem;
        }
        p {
          font-size: 1.1rem;
        }
      }
      @media (max-width: 600px) {
        h1 {
          font-size: 1.4rem;
        }
        p, li {
          font-size: 0.9rem;
        }
      }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    ${message}
  </body>
</html>`;
}

module.exports = async function handler(req, res) {
  try {
    const result = await cleanupPosters();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(renderHtml(result));
  } catch (err) {
    console.error('[Cleanup] Error general:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<html><body><h2>Error en limpieza</h2><pre>${err.message}</pre></body></html>`);
  }
};
