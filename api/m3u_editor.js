// api/m3u_editor.js
const getRawBody = require('raw-body');
const { requireAuth } = require('./utils');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const M3U_PATH = process.env.M3U_PATH || 'Lista_total.m3u';
const API_URL = `https://api.github.com/repos/${GITHUB_REPO}/contents/${M3U_PATH}`;

module.exports = async (req, res) => {
  const email = requireAuth(req, res);
  if (!email) return;

  // === API: GET M3U ===
  if (req.method === 'GET' && req.url === '/editor/data') {
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
  if (req.method === 'POST' && req.url === '/editor/data') {
    const body = await getRawBody(req);
    const { content, sha } = JSON.parse(body.toString());
    try {
      const r = await fetch(API_URL, {
        method: 'PUT',
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Heimdallr'
        },
        body: JSON.stringify({
          message: `Edit M3U - ${email} - ${new Date().toISOString()}`,
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

  // === EDITOR WEB ===
  if (req.url === '/editor' || req.url === '/editor/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    const html = `
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
    .validation-error { background: #7f1d1d; border-left: 4px solid #ef4444; }
    .validation-warning { background: #7c2d12; border-left: 4px solid #f97316; }
    .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 50; }
    .modal-content { background: #111; margin: 5% auto; padding: 2rem; width: 90%; max-width: 600px; border-radius: 12px; border: 1px solid #333; }
    .close { float: right; font-size: 1.5rem; cursor: pointer; }
  </style>
</head>
<body class="bg-black text-white min-h-screen">
  <div class="text-center py-8">
    <h1 class="text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
      Heimdallr Channels
    </h1>
    <p class="text-gray-400 mt-2 text-lg">Editor M3U</p>
  </div>

  <div class="max-w-5xl mx-auto p-6">
    <div class="bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-gray-800">
      <div class="flex justify-between items-center mb-6">
        <span class="text-green-400 font-medium">Autenticado como ` + email + `</span>
        <a href="/Acceso" class="text-gray-400 hover:text-white text-sm underline">Panel</a>
      </div>

      <div class="flex items-center gap-4 mb-4">
        <span id="channelCount" class="text-2xl font-bold text-purple-400">0 canales</span>
        <button id="addChannel" class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg">Añadir Canal</button>
        <button id="addStream" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">Añadir Stream</button>
        <button id="validate" class="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-lg">Validar M3U</button>
      </div>

      <div id="validation" class="mb-4 text-sm"></div>
      <div id="status" class="mb-4 text-sm"></div>

      <textarea id="m3u" class="w-full h-96 bg-gray-800 text-green-400 p-4 rounded-lg font-mono text-sm focus:ring-2 focus:ring-purple-500" placeholder="Cargando..."></textarea>

      <div class="mt-6 flex gap-3">
        <button id="save" class="bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-3 px-6 rounded-lg hover:from-purple-700 hover:to-pink-700 transform transition-all duration-200 hover:scale-[1.02] shadow-xl">
          Guardar en GitHub
        </button>
        <button id="reload" class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg">
          Recargar
        </button>
      </div>
    </div>
  </div>

  <!-- MODAL: AÑADIR CANAL -->
  <div id="modalChannel" class="modal">
    <div class="modal-content">
      <span class="close" onclick="closeModal('modalChannel')">&times;</span>
      <h2 class="text-xl font-bold mb-4">Añadir Canal</h2>
      <input type="text" id="channelTvgId" placeholder="tvg-id (obligatorio)" class="w-full p-2 mb-3 bg-gray-800 rounded text-white">
      <input type="text" id="channelName" placeholder="Nombre del canal" class="w-full p-2 mb-3 bg-gray-800 rounded text-white">
      <input type="url" id="channelLogo" placeholder="Logo URL (opcional)" class="w-full p-2 mb-3 bg-gray-800 rounded text-white">
      <input type="url" id="channelUrl" placeholder="URL del stream" class="w-full p-2 mb-3 bg-gray-800 rounded text-white">
      <button onclick="insertChannel()" class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded">Insertar al final</button>
    </div>
  </div>

  <!-- MODAL: AÑADIR STREAM -->
  <div id="modalStream" class="modal">
    <div class="modal-content">
      <span class="close" onclick="closeModal('modalStream')">&times;</span>
      <h2 class="text-xl font-bold mb-4">Añadir Stream a Canal Existente</h2>
      <select id="streamTvgId" class="w-full p-2 mb-3 bg-gray-800 rounded text-white">
        <option value="">-- Selecciona un canal --</option>
      </select>
      <input type="url" id="streamUrl" placeholder="URL del nuevo stream" class="w-full p-2 mb-3 bg-gray-800 rounded text-white">
      <button onclick="insertStream()" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">Añadir debajo</button>
    </div>
  </div>

  <script>
    const status = document.getElementById('status');
    const validation = document.getElementById('validation');
    const textarea = document.getElementById('m3u');
    const saveBtn = document.getElementById('save');
    const reloadBtn = document.getElementById('reload');
    const channelCount = document.getElementById('channelCount');
    const streamSelect = document.getElementById('streamTvgId');
    let currentSha = '';

    function show(msg, type = 'info') {
      const color = type === 'error' ? 'red' : type === 'success' ? 'green' : 'yellow';
      status.innerHTML = '<span class="text-' + color + '-400">' + msg + '</span>';
      setTimeout(() => status.innerHTML = '', 5000);
    }

    function updateChannelCount() {
      const lines = textarea.value.split(/\\r?\\n/);
      const extinfLines = lines.filter(l => l.trim().startsWith('#EXTINF:'));
      const streamCount = extinfLines.length;

      const uniqueTvgIds = new Set();
      extinfLines.forEach(line => {
        const match = line.match(/tvg-id="([^"]*)"/);
        if (match && match[1]) uniqueTvgIds.add(match[1]);
      });

      const channelCountNum = uniqueTvgIds.size;
      channelCount.textContent = channelCountNum + ' canal' + (channelCountNum !== 1 ? 'es' : '') + ' • ' + streamCount + ' stream' + (streamCount !== 1 ? 's' : '');
      updateStreamSelect(uniqueTvgIds);
    }

    function updateStreamSelect(tvgIds) {
      streamSelect.innerHTML = '<option value="">-- Selecciona un canal --</option>';
      if (tvgIds.size === 0) {
        streamSelect.innerHTML += '<option disabled>No hay canales con tvg-id</option>';
        return;
      }
      Array.from(tvgIds).sort().forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        streamSelect.appendChild(opt);
      });
    }

    function validateM3U() {
      validation.innerHTML = '';
      const lines = textarea.value.split(/\\r?\\n/);
      const errors = [];
      const warnings = [];
      let inChannel = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
          inChannel = true;
          if (!line.includes('tvg-id=')) warnings.push('Línea ' + (i+1) + ': Falta tvg-id');
          if (!line.includes('tvg-logo=')) warnings.push('Línea ' + (i+1) + ': Sin logo');
        } else if (inChannel && line && !line.startsWith('http')) {
          errors.push('Línea ' + (i+1) + ': Stream sin URL');
          inChannel = false;
        } else if (inChannel && line.startsWith('http')) {
          inChannel = false;
        }
      }

      if (errors.length) {
        validation.innerHTML += '<div class="validation-error p-3 mb-2 rounded"><strong>Errores:</strong><ul class="list-disc pl-5">' + errors.map(e => '<li>' + e + '</li>').join('') + '</ul></div>';
      }
      if (warnings.length) {
        validation.innerHTML += '<div class="validation-warning p-3 mb-2 rounded"><strong>Advertencias:</strong><ul class="list-disc pl-5">' + warnings.map(w => '<li>' + w + '</li>').join('') + '</ul></div>';
      }
      if (!errors.length && !warnings.length) {
        validation.innerHTML = '<div class="text-green-400 p-3 bg-green-900/50 rounded">M3U válido</div>';
      }
    }

    function openModal(id) { document.getElementById(id).style.display = 'block'; }
    function closeModal(id) { document.getElementById(id).style.display = 'none'; }

    function insertChannel() {
      const tvgId = document.getElementById('channelTvgId').value.trim();
      const name = document.getElementById('channelName').value.trim();
      const logo = document.getElementById('channelLogo').value.trim();
      const url = document.getElementById('channelUrl').value.trim();
      if (!tvgId || !name || !url) return show('Faltan tvg-id, nombre o URL', 'error');

      const logoPart = logo ? ' tvg-logo="' + logo + '"' : '';
      const entry = '\\n#EXTINF:-1 tvg-id="' + tvgId + '"' + logoPart + ' group-title="Heimdallr",' + name + '\\n' + url + '\\n';

      textarea.value += entry;
      updateChannelCount();
      closeModal('modalChannel');
      show('Canal añadido', 'success');
    }

    function insertStream() {
      const tvgId = streamSelect.value;
      const url = document.getElementById('streamUrl').value.trim();
      if (!tvgId) return show('Selecciona un canal', 'error');
      if (!url) return show('Falta la URL', 'error');

      const lines = textarea.value.split(/\\r?\\n/);
      let inserted = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('tvg-id="' + tvgId + '"') && lines[i].startsWith('#EXTINF:')) {
          lines.splice(i + 1, 0, url);
          inserted = true;
          break;
        }
      }
      if (!inserted) return show('No se encontró el canal', 'error');

      textarea.value = lines.join('\\n');
      updateChannelCount();
      closeModal('modalStream');
      show('Stream añadido', 'success');
    }

    async function load() {
      show('Cargando...', 'info');
      try {
        const r = await fetch('/editor/data');
        if (!r.ok) throw new Error('Error de red');
        const { content, sha } = await r.json();
        textarea.value = content;
        currentSha = sha;
        updateChannelCount();
        show('Listo', 'success');
      } catch (e) {
        show('Error: ' + e.message, 'error');
      }
    }

    saveBtn.onclick = async () => {
      if (!currentSha) return show('Primero recarga', 'error');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando...';
      try {
        const r = await fetch('/editor/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: textarea.value, sha: currentSha })
        });
        if (!r.ok) throw new Error('Fallo al guardar');
        show('Guardado!', 'success');
      } catch (e) {
        show('Error: ' + e.message, 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar en GitHub';
      }
    };

    reloadBtn.onclick = load;
    document.getElementById('addChannel').onclick = () => openModal('modalChannel');
    document.getElementById('addStream').onclick = () => openModal('modalStream');
    document.getElementById('validate').onclick = validateM3U;
    textarea.addEventListener('input', updateChannelCount);

    load();
  </script>
</body>
</html>`;

    return res.status(200).end(html);
  }

  res.writeHead(302, { Location: '/Acceso' });
  res.end();
};
