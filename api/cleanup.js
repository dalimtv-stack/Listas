// api/cleanup.js
'use strict';

const { cleanupOldPosters } = require('../src/cron/cleanup-posters');
const { kvGetJson, kvListKeys } = require('../api/kv');

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const result = await cleanupOldPosters();
    return res.status(200).json(result);
  }

  if (req.method === 'GET' && req.query.list === '1') {
    const allKeys = await kvListKeys();
    // extraer prefijos únicos (antes del :)
    const prefixes = [...new Set(allKeys.map(k => k.split(':')[0]))];
    return res.status(200).json({
      total: allKeys.length,
      uniquePrefixes: prefixes.length,
      prefixes
    });
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
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Limpieza de Pósters</title>
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
          text-align: center;
        }
        button {
          background: #4CAF50;
          color: white;
          padding: 0.6rem 1.2rem;
          font-size: 0.95rem;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          min-height: 40px;
          transition: background 0.2s;
          display: block;
          margin: 1rem auto;
        }
        button:hover {
          background: #45a049;
        }
        #status, #kvinfo {
          margin-top: 1rem;
          font-weight: bold;
          text-align: center;
        }
        #prefixes {
          margin-top: 1rem;
          text-align: left;
          font-size: 0.9rem;
          white-space: pre-line;
        }
        @media (min-width: 600px) {
          body { max-width: 600px; }
          h1 { font-size: 2rem; }
          p { font-size: 1.1rem; }
          button { font-size: 1rem; padding: 0.8rem 1.5rem; }
        }
        @media (max-width: 600px) {
          h1 { font-size: 1.4rem; }
          p, button { font-size: 0.9rem; }
          button { width: 100%; text-align: center; }
        }
      </style>
    </head>
    <body>
      <h1>Heimdallr Channels</h1>
      <h1>Limpieza de Pósters en KV</h1>
      <p>Última limpieza: <strong>${lastDate}</strong></p>

      <button onclick="listKeys()">Listar claves KV</button>
      <button onclick="runCleanup()">Ejecutar limpieza</button>
      
      <div id="kvinfo"></div>
      <div id="prefixes"></div>
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

        async function listKeys() {
          const kvinfo = document.getElementById('kvinfo');
          const prefixesDiv = document.getElementById('prefixes');
          kvinfo.textContent = 'Listando claves...';
          prefixesDiv.textContent = '';
          try {
            const res = await fetch('/cleanup?list=1');
            const json = await res.json();
            kvinfo.textContent = \`🔑 Total de claves: \${json.total} — Prefijos únicos: \${json.uniquePrefixes}\`;
            prefixesDiv.textContent = json.prefixes.join("\\n");
          } catch (err) {
            kvinfo.textContent = '❌ Error al listar claves';
          }
        }
      </script>
    </body>
    </html>
  `);
};
