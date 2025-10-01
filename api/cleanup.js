// api/cleanup.js
'use strict';

const { kvGetJson, kvListKeys, kvDelete, kvSetJson } = require('../api/kv');

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const dryrun = req.query.dryrun === '1';

    let allKeys = [];
    try {
      const listResult = await kvListKeys();
      allKeys = listResult.keys || [];
      console.info('[cleanup] Claves totales obtenidas:', allKeys.length);
    } catch (err) {
      console.error('[cleanup] Error listing keys:', err);
    }

    const excluded = ['postersBlobHoy', 'poster:cleanup:last'];
    const candidateKeys = allKeys.filter(k => !excluded.includes(k));

    // Función para obtener valores en batches paralelos
    async function getValuesInBatches(keys, batchSize = 50) {
      const values = new Array(keys.length);
      for (let i = 0; i < keys.length; i += batchSize) {
        const batchKeys = keys.slice(i, i + batchSize);
        const promises = batchKeys.map(async (k, j) => {
          try {
            values[i + j] = await kvGetJson(k);
          } catch (err) {
            console.error(`Error getting ${k}:`, err);
            values[i + j] = null;
          }
        });
        await Promise.all(promises);
      }
      return values;
    }

    const values = await getValuesInBatches(candidateKeys);

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let toDelete = [];
    for (let i = 0; i < candidateKeys.length; i++) {
      const value = values[i];
      if (value && typeof value.timestamp === 'number' && value.timestamp < oneWeekAgo) {
        toDelete.push(candidateKeys[i]);
      }
    }

    const prefixCountsToDelete = {};
    for (let key of toDelete) {
      const prefix = String(key).split(':')[0] || '';
      if (prefix) {
        prefixCountsToDelete[prefix] = (prefixCountsToDelete[prefix] || 0) + 1;
      }
    }

    if (dryrun) {
      return res.status(200).json({ toDelete: toDelete.length, prefixCountsToDelete });
    } else {
      let deletedCount = 0;
      let fallbackCount = 0;

      if (toDelete.length > 0) {
        // Intenta bulk delete si la función está 
        try {
          // Divide en batches de 10000 (límite de Cloudflare bulk delete)
          const bulkBatchSize = 10000;
          for (let i = 0; i < toDelete.length; i += bulkBatchSize) {
            const batch = toDelete.slice(i, i + bulkBatchSize);
            await kvBulkDelete(batch); // Descomenta cuando implementes la función
            deletedCount += batch.length;
          }
        } catch (err) {
          console.error('[cleanup] Error bulk deleting:', err);
          // Fallback a deletes individuales
          fallbackCount = toDelete.length;
          deletedCount = 0;
          for (let key of toDelete) {
            try {
              await kvDelete(key);
              deletedCount++;
            } catch (e) {
              console.error(`[cleanup] Error deleting ${key}:`, e);
            }
          }
          fallbackCount = fallbackCount - deletedCount;
        }
      }

      const now = Date.now();
      try {
        await kvSetJson('poster:cleanup:last', { timestamp: now });
      } catch (err) {
        console.error('[cleanup] Error saving last cleanup:', err);
      }

      return res.status(200).json({
        deleted: deletedCount,
        fallbackCount,
        expiredCount: toDelete.length,
        timestamp: now
      });
    }
  }

  // Endpoint JSON para listar claves (usado por el front)
  if (req.method === 'GET' && req.query.list === '1') {
    let allKeys = [];
    try {
      const listResult = await kvListKeys();
      allKeys = listResult.keys || [];
    } catch (err) {
      console.error('[cleanup] Error getting all keys:', err);
    }

    // Calcular conteos por prefijo
    const prefixCounts = {};
    for (let key of allKeys) {
      const prefix = String(key).split(':')[0] || '';
      if (prefix) {
        prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
      }
    }

    return res.status(200).json({
      total: allKeys.length,
      prefixCounts
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
          width: 100%;
          max-width: 300px;
        }
        button:hover { background: #45a049; }
        button.red {
          background: #f44336;
        }
        button.red:hover {
          background: #da190b;
        }
        button.gray {
          background: #808080;
        }
        button.gray:hover {
          background: #696969;
        }
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
          const kvinfo = document.getElementById('kvinfo');
          const prefixesDiv = document.getElementById('prefixes');
          status.textContent = 'Calculando...';
          try {
            const resDry = await fetch('/cleanup?dryrun=1', { method: 'POST' });
            const jsonDry = await resDry.json();
            const count = jsonDry.toDelete;
            if (count === 0) {
              status.textContent = 'No hay claves para borrar.';
              return;
            }
            status.textContent = 'Confirme para proceder.';
            const uniquePrefixes = Object.keys(jsonDry.prefixCountsToDelete).length;
            kvinfo.textContent = \`🔑 Claves a borrar: \${count} — Prefijos afectados: \${uniquePrefixes}\`;
            if (uniquePrefixes > 0) {
              const sortedEntries = Object.entries(jsonDry.prefixCountsToDelete).sort((a, b) => a[0].localeCompare(b[0]));
              prefixesDiv.textContent = sortedEntries.map(([p, c]) => \`\${p} (\${c})\`).join("\\n");
            } else {
              prefixesDiv.textContent = '(No hay prefijos a borrar)';
            }

            // Crear botón de confirmación rojo
            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = 'Confirmar Borrado';
            confirmBtn.classList.add('red');
            confirmBtn.onclick = async () => {
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
              confirmBtn.remove();
              cancelBtn.remove();
              prefixesDiv.textContent = '';
              kvinfo.textContent = '';
            };

            // Crear botón de cancelar gris
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancelar';
            cancelBtn.classList.add('gray');
            cancelBtn.onclick = () => {
              confirmBtn.remove();
              cancelBtn.remove();
              status.textContent = 'Limpieza cancelada.';
              prefixesDiv.textContent = '';
              kvinfo.textContent = '';
            };

            // Insertar después del botón de ejecutar limpieza
            const cleanupBtn = document.querySelector('button[onclick="runCleanup()"]');
            cleanupBtn.after(confirmBtn);
            confirmBtn.after(cancelBtn);
          } catch (err) {
            console.error('runCleanup dryrun error', err);
            status.textContent = '❌ Error al calcular claves a borrar';
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
            const uniquePrefixes = Object.keys(json.prefixCounts).length;
            kvinfo.textContent = \`🔑 Total de claves: \${json.total} — Prefijos únicos: \${uniquePrefixes}\`;
            if (uniquePrefixes > 0) {
              const sortedEntries = Object.entries(json.prefixCounts).sort((a, b) => a[0].localeCompare(b[0]));
              prefixesDiv.textContent = sortedEntries.map(([p, c]) => \`\${p} (\${c})\`).join("\\n");
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
