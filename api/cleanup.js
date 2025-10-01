// api/cleanup.js
'use strict';

const { cleanupOldPosters } = require('../src/cron/cleanup-posters'); // si no lo usas, puedes quitarlo
const {
  kvGetJson,
  kvListKeys,
  kvGet,
  kvDelete,
  kvSetJsonTTL
} = require('../api/kv');

function safeSplitPrefix(key) {
  return String(key || '').split(':')[0] || '';
}

module.exports = async (req, res) => {
  try {
    // --- LISTADO POR PREFIJO ---
    if (req.method === 'GET' && req.query && req.query.list === '1') {
      try {
        const rawKeys = await kvListKeys();
        const allKeys = Array.isArray(rawKeys) ? rawKeys : [];
        const prefixCount = {};
        for (const k of allKeys) {
          const p = safeSplitPrefix(k);
          prefixCount[p] = (prefixCount[p] || 0) + 1;
        }
        console.info(`[cleanup] list keys: ${allKeys.length}`);
        return res.status(200).json({ total: allKeys.length, prefixCount });
      } catch (e) {
        console.error('[cleanup] list error inner:', e);
        return res.status(500).json({ error: e.message || 'list error' });
      }
    }

    // --- PREVISUALIZACION DE LIMPIEZA (no borra) ---
    if (req.method === 'GET' && req.query && req.query.cleanupPreview === '1') {
      try {
        const rawKeys = await kvListKeys();
        const allKeys = Array.isArray(rawKeys) ? rawKeys : [];
        const now = Date.now();
        const weekMs = 7 * 24 * 60 * 60 * 1000;
        const toDelete = [];

        for (const key of allKeys) {
          if (key === 'postersBlobHoy' || key === 'poster:cleanup:last') continue;
          try {
            const val = await kvGetJson(key);
            // val may be wrapper or raw object; we look for timestamp inside
            const timestamp = val && (val.timestamp || (val.data && val.data.timestamp) || null);
            if (typeof timestamp === 'number' && now - timestamp > weekMs) {
              toDelete.push(key);
            }
          } catch (e) {
            // ignorar claves con valor no parseable
          }
        }

        const deleteByPrefix = {};
        for (const k of toDelete) {
          const p = safeSplitPrefix(k);
          deleteByPrefix[p] = (deleteByPrefix[p] || 0) + 1;
        }

        console.info(`[cleanup] preview: ${toDelete.length} keys old >7d`);
        return res.status(200).json({
          toDeleteCount: toDelete.length,
          deleteByPrefix,
          keys: toDelete
        });
      } catch (e) {
        console.error('[cleanup] preview error inner:', e);
        return res.status(500).json({ error: e.message || 'preview error' });
      }
    }

    // --- EJECUTAR BORRADO (confirmado) ---
    if (req.method === 'POST' && req.query && req.query.confirm === '1') {
      let body = '';
      await new Promise((resolve) => {
        req.on('data', chunk => (body += chunk));
        req.on('end', resolve);
        req.on('error', resolve);
      });

      let parsed;
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch (e) {
        parsed = {};
      }

      // aceptamos { keys: [...] } o una array directa
      const keysToTry = Array.isArray(parsed.keys) ? parsed.keys : (Array.isArray(parsed) ? parsed : (parsed.keys && Array.isArray(parsed.keys) ? parsed.keys : []));

      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      let deleted = 0;
      const actuallyDeleted = [];

      for (const key of keysToTry) {
        if (!key) continue;
        if (key === 'postersBlobHoy' || key === 'poster:cleanup:last') continue;

        try {
          const val = await kvGetJson(key);
          const timestamp = val && (val.timestamp || (val.data && val.data.timestamp) || null);
          if (typeof timestamp === 'number' && now - timestamp > weekMs) {
            await kvDelete(key);
            deleted++;
            actuallyDeleted.push(key);
            console.info(`[cleanup] deleted key: ${key}`);
          } else {
            console.info(`[cleanup] skip not-old key: ${key}`);
          }
        } catch (e) {
          console.warn(`[cleanup] error deleting key ${key}:`, e.message || e);
        }
      }

      // actualizar registro de última limpieza (wrapped object con timestamp)
      try {
        await kvSetJsonTTL('poster:cleanup:last', { deleted }, 86400);
      } catch (e) {
        console.warn('[cleanup] warning saving poster:cleanup:last', e.message || e);
      }

      return res.status(200).json({ deleted, timestamp: Date.now(), deletedKeys: actuallyDeleted });
    }

    // --- Página HTML (UI) ---
    const last = await kvGetJson('poster:cleanup:last');
    const lastDate = last?.timestamp
      ? new Date(last.timestamp).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })
      : 'Nunca';

    res.setHeader('Content-Type', 'text/html');
    return res.end(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Limpieza de Pósters</title>
<style>
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif;
  max-width: 90%;
  margin: 1rem auto;
  padding: 0 0.5rem;
  color: #333;
}
h1 { font-size: 1.6rem; text-align:center; margin-bottom:0.5rem; }
p { text-align:center; }
button {
  background: #4CAF50;
  color: white;
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  display:block;
  margin: 0.8rem auto;
}
button.danger { background: #e53935; }
#status, #kvinfo, #prefixes, #preview { white-space: pre-wrap; text-align:center; margin-top: 0.8rem; }
</style>
</head>
<body>
  <h1>Heimdallr Channels</h1>
  <h1>Limpieza de Pósters en KV</h1>
  <p>Última limpieza: <strong>${lastDate}</strong></p>

  <button onclick="listKeys()">Listar claves KV</button>
  <button onclick="previewCleanup()">Previsualizar limpieza</button>

  <div id="kvinfo"></div>
  <div id="prefixes"></div>
  <div id="preview"></div>
  <div id="status"></div>

<script>
let pendingDelete = [];

async function listKeys() {
  const kvinfo = document.getElementById('kvinfo');
  const prefixes = document.getElementById('prefixes');
  kvinfo.textContent = 'Listando...';
  prefixes.textContent = '';
  try {
    const res = await fetch('/cleanup?list=1');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    kvinfo.textContent = 'Total claves: ' + (json.total || 0);
    const pc = json.prefixCount || {};
    prefixes.textContent = Object.entries(pc).map(([p,n]) => p + ': ' + n).join('\\n');
  } catch (err) {
    console.error('listKeys error', err);
    kvinfo.textContent = 'Error al listar';
    prefixes.textContent = '';
  }
}

async function previewCleanup() {
  const status = document.getElementById('status');
  const preview = document.getElementById('preview');
  status.textContent = 'Analizando...';
  preview.textContent = '';
  pendingDelete = [];
  try {
    const res = await fetch('/cleanup?cleanupPreview=1');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    pendingDelete = json.keys || [];
    const byPref = json.deleteByPrefix || {};
    if ((json.toDeleteCount || 0) > 0) {
      preview.textContent = '📋 Resumen por prefijo (claves a borrar):\\n' +
        Object.entries(byPref).map(([p,n]) => p + ': ' + n).join('\\n') +
        '\\n\\nTotal: ' + json.toDeleteCount;

      // botón Borrar ahora
      const btn = document.createElement('button');
      btn.textContent = 'Borrar ahora';
      btn.className = 'danger';
      btn.onclick = confirmCleanup;
      preview.appendChild(document.createElement('br'));
      preview.appendChild(btn);
    } else {
      preview.textContent = 'No hay claves antiguas para borrar';
    }
    status.textContent = '';
  } catch (err) {
    console.error('previewCleanup error', err);
    status.textContent = 'Error al analizar claves';
  }
}

async function confirmCleanup() {
  const status = document.getElementById('status');
  status.textContent = 'Borrando...';
  try {
    const res = await fetch('/cleanup?confirm=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: pendingDelete })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    status.textContent = '✅ Borradas ' + (json.deleted || 0) + ' claves';
  } catch (err) {
    console.error('confirmCleanup error', err);
    status.textContent = 'Error al borrar claves';
  }
}
</script>
</body>
</html>
    `);
  } catch (err) {
    console.error('[cleanup] outer error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.message || 'server error' }));
  }
};
