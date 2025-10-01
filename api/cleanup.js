'use strict';

const { cleanupOldPosters, kvGetJson, kvListKeys, kvDelete } = require('../api/kv');

module.exports = async (req, res) => {

  // --- API: listar claves y contar por prefijo ---
  if (req.method === 'GET' && req.query.list === '1') {
    try {
      const allKeys = await kvListKeys();
      if (!Array.isArray(allKeys)) throw new Error('KV listKeys no devolvió array');

      const prefixCount = {};
      for (const k of allKeys) {
        const prefix = String(k).split(':')[0] || '';
        prefixCount[prefix] = (prefixCount[prefix] || 0) + 1;
      }

      return res.status(200).json({ total: allKeys.length, prefixCount });
    } catch (e) {
      console.error('[cleanup] list error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // --- API: preview limpieza ---
  if (req.method === 'GET' && req.query.cleanupPreview === '1') {
    try {
      const allKeys = await kvListKeys();
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const toDelete = [];

      for (const key of allKeys) {
        if (key === 'postersBlobHoy' || key === 'poster:cleanup:last') continue;
        const val = await kvGetJson(key);
        if (val?.timestamp && now - val.timestamp > weekMs) {
          toDelete.push(key);
        }
      }

      // --- Agrupar por prefijo ---
      const deleteByPrefix = {};
      for (const k of toDelete) {
        const prefix = String(k).split(':')[0] || '';
        deleteByPrefix[prefix] = (deleteByPrefix[prefix] || 0) + 1;
      }

      return res.status(200).json({
        toDeleteCount: toDelete.length,
        deleteByPrefix,
        keys: toDelete
      });
    } catch (e) {
      console.error('[cleanup] preview error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // --- API: ejecutar limpieza ---
  if (req.method === 'POST' && req.query.confirm === '1') {
    let keys = [];
    try {
      const body = await new Promise(resolve => {
        let data = '';
        req.on('data', chunk => (data += chunk));
        req.on('end', () => resolve(data));
      });
      keys = JSON.parse(body).keys || [];
    } catch {}

    let deleted = 0;
    for (const key of keys) {
      try {
        await kvDelete(key);
        deleted++;
      } catch {}
    }

    return res.status(200).json({ deleted, timestamp: Date.now() });
  }

  // --- Página HTML ---
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
h1 { font-size: 1.8rem; text-align: center; margin-bottom: 1rem; }
p { font-size: 1rem; margin-bottom: 0.8rem; text-align: center; }
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
#status, #kvinfo, #prefixes, #previewPrefixes {
  margin-top: 1rem;
  font-weight: bold;
  text-align: center;
  white-space: pre-line;
}
@media (min-width: 600px) { body { max-width: 600px; } h1 { font-size: 2rem; } p { font-size: 1.1rem; } button { font-size: 1rem; padding: 0.8rem 1.5rem; } }
@media (max-width: 600px) { h1 { font-size: 1.4rem; } p, button { font-size: 0.9rem; } button { width: 100%; text-align: center; } }
</style>
</head>
<body>
<h1>Heimdallr Channels</h1>
<h1>Limpieza de Pósters en KV</h1>
<p>Última limpieza: <strong>${lastDate}</strong></p>

<button onclick="listKeys()">Listar claves KV</button>
<button onclick="previewCleanup()">Ejecutar limpieza</button>

<div id="kvinfo"></div>
<div id="prefixes"></div>
<div id="previewPrefixes"></div>
<div id="status"></div>

<script>
async function listKeys() {
  const kvinfo = document.getElementById('kvinfo');
  const prefixesDiv = document.getElementById('prefixes');
  kvinfo.textContent = 'Listando...';
  try {
    const res = await fetch('/cleanup?list=1');
    const json = await res.json();
    kvinfo.textContent = \`Total claves: \${json.total}\`;
    prefixesDiv.textContent = Object.entries(json.prefixCount)
      .map(([p, n]) => \`\${p}: \${n}\`).join("\\n");
  } catch (err) {
    kvinfo.textContent = 'Error al listar';
  }
}

async function previewCleanup() {
  const status = document.getElementById('status');
  const previewPrefixes = document.getElementById('previewPrefixes');
  status.textContent = 'Analizando claves...';
  previewPrefixes.textContent = '';
  try {
    const res = await fetch('/cleanup?cleanupPreview=1');
    const json = await res.json();
    if (json.toDeleteCount > 0) {
      previewPrefixes.textContent = '📋 Resumen por prefijo (claves a borrar):\\n' +
        Object.entries(json.deleteByPrefix)
          .map(([p, n]) => \`\${p}: \${n}\`).join("\\n");

      if (confirm(\`¿Seguro que quieres borrar \${json.toDeleteCount} claves?\`)) {
        const res2 = await fetch('/cleanup?confirm=1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: json.keys })
        });
        const result = await res2.json();
        status.textContent = \`✅ Borradas \${result.deleted} claves\`;
      } else {
        status.textContent = '❌ Limpieza cancelada';
      }
    } else {
      status.textContent = 'No hay claves antiguas para borrar';
    }
  } catch (err) {
    status.textContent = 'Error al analizar/borrar claves';
  }
}
</script>
</body>
</html>
  `);
};
