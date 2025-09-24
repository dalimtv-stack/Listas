// api/cleanup.js
'use strict';

const { cleanupOldPosters } = require('../src/cron/cleanup-posters');
const { kvGetJson } = require('../api/kv');

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const result = await cleanupOldPosters();
    return res.status(200).json(result);
  }

  const last = await kvGetJson('poster:cleanup:last');
  const lastDate = last?.timestamp
    ? new Date(last.timestamp).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })
    : 'Nunca';

  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Limpieza de Pósters</title>
      <style>
        body { font-family: sans-serif; padding: 2em; background: #f5f5f5; }
        button { padding: 1em 2em; font-size: 1rem; background: #0070f3; color: white; border: none; cursor: pointer; }
        button:hover { background: #005bb5; }
        #status { margin-top: 1em; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>Limpieza de Pósters en KV</h1>
      <p>Última limpieza: <strong>${lastDate}</strong></p>
      <button onclick="runCleanup()">Ejecutar limpieza</button>
      <div id="status"></div>

      <script>
        async function runCleanup() {
          const status = document.getElementById('status');
          status.textContent = 'Ejecutando...';
          try {
            const res = await fetch('/cleanup', { method: 'POST' });
            const json = await res.json();
            const fecha = new Date(json.timestamp).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
            status.textContent = \`✅ Eliminados: \${json.deleted} (\${json.fallbackCount} fallback, \${json.expiredCount} expirados) — \${fecha}\`;
          } catch (err) {
            status.textContent = '❌ Error al ejecutar limpieza';
          }
        }
      </script>
    </body>
    </html>
  `);
};
