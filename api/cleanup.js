// api/cleanup.js
'use strict';

const { cleanupOldPosters } = require('../src/cron/cleanup-posters');

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const result = await cleanupOldPosters();
    return res.status(200).json(result);
  }

  // Renderiza HTML con botón
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
      <p>Este botón ejecuta la limpieza de pósters antiguos o de fallback.</p>
      <button onclick="runCleanup()">Ejecutar limpieza</button>
      <div id="status"></div>

      <script>
        async function runCleanup() {
          const status = document.getElementById('status');
          status.textContent = 'Ejecutando...';
          try {
            const res = await fetch('/cleanup', { method: 'POST' });
            const json = await res.json();
            status.textContent = \`✅ Eliminados: \${json.deleted} (\${json.fallbackCount} fallback, \${json.expiredCount} expirados)\`;
          } catch (err) {
            status.textContent = '❌ Error al ejecutar limpieza';
          }
        }
      </script>
    </body>
    </html>
  `);
};
