// api/cleanup.js
'use strict';

const { kvGetJson, kvListKeys, kvDelete } = require('../api/kv');
const { cleanupOldPosters } = require('../src/cron/cleanup-posters');

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = async (req, res) => {

  if (req.method === 'POST') {
    // Limpieza de pósters normal
    const result = await cleanupOldPosters();
    return res.status(200).json(result);
  }

  // Endpoint JSON para listar claves
  if (req.method === 'GET' && req.query.list === '1') {
    let allKeys;
    try {
      allKeys = await kvListKeys();
      if (!Array.isArray(allKeys)) allKeys = [];
    } catch (err) {
      console.error('[cleanup] Error calling kvListKeys():', err?.message || err);
      allKeys = [];
    }

    // Contar prefijos
    const prefixCounts = {};
    allKeys.forEach(k => {
      const p = String(k).split(':')[0] || '';
      if (p) prefixCounts[p] = (prefixCounts[p] || 0) + 1;
    });

    const prefixesWithCount = Object.entries(prefixCounts).map(([p, c]) => `${p} : ${c}`);

    return res.status(200).json({
      total: allKeys.length,
      uniquePrefixes: prefixesWithCount.length,
      prefixes: prefixesWithCount
    });
  }

  // Página HTML
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
#status, #kvinfo { margin-top: 1rem; font-weight: bold; text-align: center; }
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

async function runCleanup() {
  const status = document.getElementById('status');
  status.textContent = 'Calculando claves a borrar...';
  try {
    const resKeys = await fetch('/cleanup?list=1');
    const jsonKeys = await resKeys.json();
    if (!Array.isArray(jsonKeys.prefixes)) {
      status.textContent = '❌ Error al obtener claves';
      return;
    }

    // Obtener todas las claves para revisar timestamps
    let allKeys = await fetch('/cleanup?list=1').then(r => r.json()).then(j => j.prefixes.map(l => l.split(' : ')[0]));
    
    // Filtrar claves a borrar (timestamp > 1 semana)
    const keysToDelete = [];
    for (const key of allKeys) {
      if (key === 'postersBlobHoy' || key === 'poster:cleanup:last') continue;
      const val = await fetchKVValue(key);
      if (!val) continue;
      try {
        const parsed = JSON.parse(val);
        if (parsed.timestamp && Date.now() - parsed.timestamp > ${ONE_WEEK_MS}) {
          keysToDelete.push(key);
        }
      } catch {}
    }

    if (!keysToDelete.length) {
      status.textContent = '✅ No hay claves que borrar';
      return;
    }

    if (!confirm(\`⚠️ Se van a borrar \${keysToDelete.length} claves. ¿Seguro?\`)) {
      status.textContent = '❌ Cancelado por el usuario';
      return;
    }

    // Borrar
    for (const key of keysToDelete) {
      await fetch('/kv-delete?key=' + encodeURIComponent(key)); // Aquí tu endpoint para borrar clave
    }

    status.textContent = \`✅ Borradas \${keysToDelete.length} claves\`;
    listKeys(); // refrescar listado
  } catch (err) {
    console.error('runCleanup error', err);
    status.textContent = '❌ Error al ejecutar limpieza';
  }
}

async function fetchKVValue(key) {
  try {
    const res = await fetch('/kv-get?key=' + encodeURIComponent(key));
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}
</script>
</body>
</html>
`);
};
