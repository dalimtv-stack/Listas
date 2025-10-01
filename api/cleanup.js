'use strict';

const { cleanupOldPosters } = require('../src/cron/cleanup-posters');
const { kvGetJson, kvListKeys, kvDelete, kvGetJsonTTL } = require('../api/kv');

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const result = await cleanupOldPosters();
    return res.status(200).json(result);
  }

  // Endpoint JSON para listar claves (usado por el front)
  if (req.method === 'GET' && req.query.list === '1') {
    let allKeys = [];
    try {
      allKeys = await kvListKeys();
      if (!Array.isArray(allKeys)) allKeys = [];
      // Log por lotes de 100
      for (let i = 0; i < allKeys.length; i += 100) {
        console.info(`[KV] Claves batch ${i}-${i + 99}:`, allKeys.slice(i, i + 100));
      }
    } catch (err) {
      console.error('[cleanup] Error llamando kvListKeys():', err?.message || err);
      allKeys = [];
    }

    const prefixesMap = {};
    allKeys.forEach(k => {
      const p = String(k).split(':')[0] || '';
      if (!p) return;
      if (!prefixesMap[p]) prefixesMap[p] = 0;
      prefixesMap[p]++;
    });

    const prefixes = Object.entries(prefixesMap).map(([p, c]) => `${p} : ${c}`);

    return res.status(200).json({
      total: allKeys.length,
      uniquePrefixes: Object.keys(prefixesMap).length,
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
  body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif; max-width:90%; margin:1rem auto; padding:0 0.5rem; line-height:1.5; color:#333; }
  h1 { font-size:1.8rem; text-align:center; margin-bottom:1rem; }
  p { font-size:1rem; margin-bottom:0.8rem; text-align:center; }
  button { background:#4CAF50; color:white; font-size:1rem; border:none; border-radius:5px; cursor:pointer; min-height:50px; width:100%; max-width:300px; display:block; margin:0.8rem auto; transition: background 0.2s; }
  button:hover { background:#45a049; }
  #status,#kvinfo { margin-top:1rem; font-weight:bold; text-align:center; }
  #prefixes { margin-top:1rem; text-align:left; font-size:0.95rem; white-space: pre-line; background:#f7f7f7; padding:0.6rem; border-radius:6px; max-height:40vh; overflow:auto; }
  @media(min-width:600px){ body{max-width:600px;} h1{font-size:2rem;} p{font-size:1.1rem;} button{font-size:1rem; padding:0.8rem 1.5rem;} }
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
    if(!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();
    kvinfo.textContent = \`🔑 Total de claves: \${json.total} — Prefijos únicos: \${json.uniquePrefixes}\`;
    if(Array.isArray(json.prefixes) && json.prefixes.length>0){
      prefixesDiv.textContent = json.prefixes.join("\\n");
    } else { prefixesDiv.textContent = '(No se encontraron prefijos)'; }
  } catch(err){
    console.error('listKeys error',err);
    kvinfo.textContent='❌ Error al listar claves';
    prefixesDiv.textContent='';
  }
}

async function runCleanup() {
  const status = document.getElementById('status');
  status.textContent='Calculando claves a borrar...';
  try {
    const allKeysRes = await fetch('/cleanup?list=1');
    const allKeysJson = await allKeysRes.json();
    const allKeys = allKeysJson.total && allKeysJson.prefixes ? allKeysJson.prefixes.map(p => p.split(' : ')[0]) : [];
    
    // Excluir claves que no se deben borrar
    const exclude = ['postersBlobHoy','poster:cleanup:last'];

    // Contar claves a borrar
    let countToDelete = 0;
    for(const k of allKeys){
      if(exclude.includes(k)) continue;
      const val = await fetchKVValue(k); // Implementar fetchKVValue que obtiene JSON
      if(val?.timestamp && (Date.now() - val.timestamp > ${ONE_WEEK_MS})) countToDelete++;
    }

    if(!confirm('¿Seguro que quieres borrar ' + countToDelete + ' claves antiguas?')) {
      status.textContent='🛑 Limpieza cancelada';
      return;
    }

    status.textContent='Ejecutando limpieza...';

    let deleted=0;
    for(const k of allKeys){
      if(exclude.includes(k)) continue;
      const val = await fetchKVValue(k);
      if(val?.timestamp && (Date.now() - val.timestamp > ${ONE_WEEK_MS})){
        await deleteKVKey(k);
        deleted++;
      }
    }
    status.textContent='✅ Claves borradas: '+deleted;

  } catch(err){
    console.error('runCleanup error',err);
    status.textContent='❌ Error al ejecutar limpieza';
  }
}

async function fetchKVValue(key){
  try{
    const res = await fetch('/api/kv?key='+encodeURIComponent(key));
    if(!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function deleteKVKey(key){
  try{ await fetch('/api/kv?key='+encodeURIComponent(key), {method:'DELETE'}); }catch{}
}
</script>
</body>
</html>
  `);
};
