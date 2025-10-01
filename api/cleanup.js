// api/cleanup.js
'use strict';

const { cleanupOldPosters } = require('../src/cron/cleanup-posters');
const { kvGetJson, kvListKeys } = require('../api/kv');

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const result = await cleanupOldPosters();
    return res.status(200).json(result);
  }

  // Endpoint JSON para listar claves (usado por el front)
  if (req.method === 'GET' && req.query.list === '1') {
    let allKeys;
    try {
      allKeys = await kvListKeys();
      console.info('[cleanup] kvListKeys() returned typeof:', typeof allKeys);
    } catch (err) {
      console.error('[cleanup] Error calling kvListKeys():', err?.message || err);
      allKeys = [];
    }

    // Normalizar distintos formatos de retorno a un array de strings
    if (!Array.isArray(allKeys)) {
      if (allKeys && typeof allKeys === 'object') {
        // Cloudflare API style: { result: [ { name: 'key' }, ... ], result_info: {...} }
        if (Array.isArray(allKeys.result)) {
          allKeys = allKeys.result.map(item => {
            if (typeof item === 'string') return item;
            return item.name || item.key || String(item);
          });
        } else if (Array.isArray(allKeys.keys)) {
          allKeys = allKeys.keys.map(k => (typeof k === 'string' ? k : k.name || String(k)));
        } else {
          // Intentar convertir objeto simple a array de claves si tiene propiedades
          try {
            allKeys = Object.keys(allKeys);
          } catch {
            allKeys = [];
          }
        }
      } else if (typeof allKeys === 'string') {
        // Podría ser JSON string o lista simple; intentar parsear
        try {
          const parsed = JSON.parse(allKeys);
          if (Array.isArray(parsed)) allKeys = parsed;
          else allKeys = [allKeys];
        } catch {
          // No JSON -> convertir a array con la cadena
          allKeys = allKeys.length ? [allKeys] : [];
        }
      } else {
        // null/undefined u otro tipo
        allKeys = [];
      }
    }

    // Ahora allKeys es garantizado un array
    console.info('[cleanup] Claves totales obtenidas (muestra 0..10):', allKeys.slice(0, 10));

    // Extraer prefijos (parte antes de ':') y normalizar
    const prefixes = [...new Set(allKeys.map(k => String(k).split(':')[0] || ''))].filter(Boolean);

    return res.status(200).json({
      total: allKeys.length,
      uniquePrefixes: prefixes.length,
      prefixes
    });
  }

  // Página HTML principal
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
        button:hover { background: #45a049; }
        #status, #kvinfo {
          margin-top: 1rem;
          font-weight: bold;
          text-align: center;
        }
        #prefixes {
          margin-top: 1rem;
          text-align: left;
          font-size: 0.95rem;
          white-space: pre-line;
          background: #f7f7f7;
          padding: 0.6rem;
          border-radius: 6px;
          max-height: 40vh;
          overflow: auto;
        }
        @media (min-width: 600px) {
          body { max-width: 600px; }
          h1 { font-size: 2rem; }
          p { font-size: 1.1rem; }
          button { font-size: 1rem; padding: 0.8rem 1.5rem; }
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
            console.error('runCleanup error', err);
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
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const json = await res.json();
            kvinfo.textContent = \`🔑 Total de claves: \${json.total} — Prefijos únicos: \${json.uniquePrefixes}\`;
            if (Array.isArray(json.prefixes) && json.prefixes.length > 0) {
              prefixesDiv.textContent = json.prefixes.join("\\n");
            } else {
              prefixesDiv.textContent = '(No se encontraron prefijos)';
            }
          } catch (err) {
            console.error('listKeys error', err);
            kvinfo.textContent = '❌ Error al listar claves';
            prefixesDiv.textContent = '';
          }
        }
      </script>
    </body>
    </html>
  `);
};
