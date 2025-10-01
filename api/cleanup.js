// api/cleanup.js
'use strict';

const { kvGetJson, kvListKeys, kvDelete } = require('../api/kv');

module.exports = async (req, res) => {
  // API: listar claves y contarlas por prefijo
  if (req.method === 'GET' && req.query.list === '1') {
    let allKeys = [];
    try {
      const resp = await kvListKeys();
      if (Array.isArray(resp)) {
        allKeys = resp;
      } else if (resp?.result) {
        allKeys = resp.result.map(k => k.name);
      }
    } catch (e) {
      console.error('[cleanup] list error', e);
    }

    // Agrupar por prefijo
    const prefixCount = {};
    for (const k of allKeys) {
      const prefix = String(k).split(':')[0] || '';
      if (!prefixCount[prefix]) prefixCount[prefix] = 0;
      prefixCount[prefix]++;
    }

    return res.status(200).json({
      total: allKeys.length,
      prefixCount
    });
  }

  // API: preview limpieza (calcular qué se borraría)
  if (req.method === 'GET' && req.query.cleanupPreview === '1') {
    let allKeys = [];
    try {
      const resp = await kvListKeys();
      allKeys = Array.isArray(resp) ? resp : resp?.result?.map(k => k.name) || [];
    } catch (e) {
      console.error('[cleanup] preview error', e);
    }

    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const toDelete = [];

    for (const key of allKeys) {
      if (key === 'postersBlobHoy' || key === 'poster:cleanup:last') continue;
      try {
        const value = await kvGetJson(key);
        if (value?.timestamp && now - value.timestamp > weekMs) {
          toDelete.push(key);
        }
      } catch {}
    }

    return res.status(200).json({ toDeleteCount: toDelete.length, keys: toDelete });
  }

  // API: ejecutar borrado confirmado
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

  // Página HTML
  res.setHeader('Content-Type', 'text/html');
  res.end(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Limpieza KV</title>
  <style>
    body { font-family: sans-serif; max-width: 600px; margin: auto; }
    button { margin: 0.5rem auto; display: block; padding: 0.6rem 1.2rem; }
    #prefixes { white-space: pre-line; background:#f5f5f5; padding:0.5rem; }
  </style>
</head>
<body>
  <h1>Limpieza de Pósters en KV</h1>
  <button onclick="listKeys()">Listar claves KV</button>
  <button onclick="previewCleanup()">Ejecutar limpieza</button>

  <div id="kvinfo"></div>
  <div id="prefixes"></div>
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
      status.textContent = 'Analizando claves...';
      try {
        const res = await fetch('/cleanup?cleanupPreview=1');
        const json = await res.json();
        if (json.toDeleteCount > 0) {
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
