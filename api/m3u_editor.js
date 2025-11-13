// api/m3u_editor.js
const getRawBody = require('raw-body');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const M3U_PATH = process.env.M3U_PATH || 'Lista_total.m3u';
const API_URL = `https://api.github.com/repos/${GITHUB_REPO}/contents/${M3U_PATH}`;

// Reutilizamos las funciones del config-index.js (no duplicamos)
const { esTokenValido } = require('./config-index');

module.exports = async (req, res) => {
  const cookies = req.headers.cookie || '';
  const token = cookies.match(/auth_token=([^;]+)/)?.[1];

  // === API: GET M3U ===
  if (req.method === 'GET' && req.url === '/api/m3u_editor/data') {
    if (!esTokenValido(token)) return res.status(401).json({ error: 'No autorizado' });

    try {
      const r = await fetch(API_URL, {
        headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'Heimdallr' }
      });
      if (!r.ok) throw new Error(`GitHub: ${r.status}`);
      const data = await r.json();
      const content = Buffer.from(data.content, 'base64').toString('utf8');
      res.json({ content, sha: data.sha });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // === API: POST M3U ===
  if (req.method === 'POST' && req.url === '/api/m3u_editor/data') {
    if (!esTokenValido(token)) return res.status(401).json({ error: 'No autorizado' });

    const { content, sha } = JSON.parse((await getRawBody(req)).toString());

    try {
      const r = await fetch(API_URL, {
        method: 'PUT',
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Heimdallr'
        },
        body: JSON.stringify({
          message: `Edit M3U via Editor - ${new Date().toISOString()}`,
          content: Buffer.from(content).toString('base64'),
          sha
        })
      });
      if (!r.ok) throw new Error(`GitHub: ${r.status}`);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // === EDITOR WEB (solo si está autenticado) ===
  if (esTokenValido(token)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).end(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Heimdallr M3U Editor</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
    textarea { tab-size: 2; }
    .live-badge { animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.7; } }
  </style>
</head>
<body class="bg-black text-white min-h-screen">
  <div class="text-center py-8">
    <h1 class="text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
      Heimdallr Channels
      <span class="live-badge inline-block ml-3 text-xs font-bold bg-red-600 text-white px-2 py-0.5 rounded-full">LIVE</span>
    </h1>
    <p class="text-gray-400 mt-2 text-lg">Editor M3U en GitHub</p>
  </div>

  <div class="max-w-5xl mx-auto p-6">
    <div class="bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-gray-800">
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center">
            <svg class="w-6 h-6 text-green-400" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
            </svg>
          </div>
          <span class="font-medium text-green-400">Autenticado</span>
        </div>
        <a href="/Acceso" class="text-gray-400 hover:text-white text-sm underline">Volver al panel</a>
      </div>

      <div id="status" class="mb-4 text-sm"></div>

      <textarea id="m3u" class="w-full h-96 bg-gray-800 text-green-400 p-4 rounded-lg font-mono text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" placeholder="Cargando M3U..."></textarea>

      <div class="mt-6 flex gap-3">
        <button id="save" class="bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-3 px-6 rounded-lg hover:from-purple-700 hover:to-pink-700 transform transition-all duration-200 hover:scale-[1.02] shadow-xl flex items-center gap-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-6 0V5a2 2 0 012-2h4a2 2 0 012 2v2m-6 5h6m-6 4h6"/></svg>
          Guardar en GitHub
        </button>
        <button id="reload" class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg flex items-center gap-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h5m10 10v-5h-5"/></svg>
          Recargar
        </button>
      </div>
    </div>
  </div>

  <script>
    const status = document.getElementById('status');
    const textarea = document.getElementById('m3u');
    const saveBtn = document.getElementById('save');
    const reloadBtn = document.getElementById('reload');
    let currentSha = '';

    function showStatus(msg, type = 'info') {
      status.innerHTML = `<span class="text-${type === 'error' ? 'red' : type === 'success' ? 'green' : 'yellow'}-400">${msg}</span>`;
      setTimeout(() => status.innerHTML = '', 5000);
    }

    async function loadM3U() {
      showStatus('Cargando M3U desde GitHub...', 'info');
      try {
        const r = await fetch('/api/m3u_editor/data');
        if (!r.ok) throw new Error('No autorizado o error');
        const { content, sha } = await r.json();
        textarea.value = content;
        currentSha = sha;
        showStatus('M3U cargado', 'success');
      } catch (e) {
        showStatus('Error: ' + e.message, 'error');
        if (e.message.includes('autorizado')) {
          setTimeout(() => location.href = '/Acceso', 2000);
        }
      }
    }

    saveBtn.onclick = async () => {
      if (!currentSha) return showStatus('Primero recarga', 'error');
      saveBtn.disabled = true;
      saveBtn.innerHTML = 'Guardando...';
      try {
        const r = await fetch('/api/m3u_editor/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: textarea.value, sha: currentSha })
        });
        if (!r.ok) throw new Error('Fallo al guardar');
        showStatus('Guardado en GitHub!', 'success');
      } catch (e) {
        showStatus('Error: ' + e.message, 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-6 0V5a2 2 0 012-2h4a2 2 0 012 2v2m-6 5h6m-6 4h6"/></svg> Guardar en GitHub';
      }
    };

    reloadBtn.onclick = loadM3U;
    loadM3U();
  </script>
</body>
</html>
    `);
  }

  // === NO AUTENTICADO → REDIRIGIR AL LOGIN ===
  res.writeHead(302, { Location: '/Acceso' });
  res.end();
};
