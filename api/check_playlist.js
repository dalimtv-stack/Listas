const { parse } = require('@iptv/playlist');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Method Not Allowed');
  }

  const { url } = req.query;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const basePath = '/comprobar';

  if (!url || !url.trim().startsWith('http')) {
    return res.end(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Heimdallr Channels – Visor M3U</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
    .card { transition: all 0.3s ease; }
    .card:hover { transform: translateY(-6px); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
  </style>
</head>
<body class="bg-black text-white min-h-screen">
  <!-- Formulario igual que antes -->
  <div class="text-center py-12">
    <h1 class="text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
      Visor de Listas M3U
    </h1>
    <p class="text-gray-400 mt-3 text-xl">Carga tu playlist IPTV</p>
  </div>
  <div class="max-w-3xl mx-auto px-6">
    <div class="bg-gray-900/80 backdrop-blur-xl rounded-2xl shadow-2xl p-10 border border-gray-800">
      <form action="${basePath}" method="GET" class="space-y-6">
        <div>
          <label class="block text-lg font-medium text-gray-300 mb-3">URL de la lista (.m3u / .m3u8)</label>
          <input type="url" name="url" required placeholder="https://example.com/iptv.m3u8"
                 class="w-full px-5 py-4 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-600 focus:border-transparent text-lg" />
        </div>
        <button type="submit" class="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-4 rounded-xl transform transition-all duration-200 hover:scale-[1.02] shadow-xl text-lg">
          Cargar y Mostrar Canales
        </button>
      </form>
      <div class="mt-10 text-center">
        <a href="/" class="text-gray-400 hover:text-purple-400 transition-colors">← Volver al panel principal</a>
      </div>
    </div>
  </div>
</body>
</html>
    `);
  }

  try {
    const response = await fetch(url.trim(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Heimdallr/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status} - ${response.statusText}`);

    const text = await response.text();

    let channels = [];

    try {
      const playlist = parse(text);
      channels = playlist.items
        .filter(item => item.url && item.url.startsWith('http'))
        .map(item => ({
          name: item.name?.trim() || 'Canal sin nombre',
          url: item.url,
          logo: item.attrs?.['tvg-logo'] || '',
          group: item.attrs?.['group-title'] || 'Sin categoría',
        }));
    } catch (e) { console.error('Parser falló:', e); }

    if (channels.length === 0 && text.includes('#EXTINF')) {
      const lines = text.split('\n');
      let current = null;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#EXTINF:')) {
          const nameMatch = trimmed.match(/,(.+)$/);
          const groupMatch = trimmed.match(/group-title="([^"]+)"/i);
          const logoMatch = trimmed.match(/tvg-logo="([^"]+)"/i);
          current = {
            name: nameMatch ? nameMatch[1].trim() : 'Sin nombre',
            group: groupMatch ? groupMatch[1].trim() : 'General',
            logo: logoMatch ? logoMatch[1].trim() : '',
          };
        } else if (trimmed.startsWith('http') && current) {
          current.url = trimmed;
          channels.push(current);
          current = null;
        }
      }
    }

    channels.sort((a, b) => a.name.localeCompare(b.name));

    const total = channels.length;
    const title = 'Lista IPTV';

    // Agrupar por grupo
    const groups = {};
    channels.forEach(ch => {
      const g = ch.group || 'Sin categoría';
      if (!groups[g]) groups[g] = [];
      groups[g].push(ch);
    });

    let htmlGroups = '';
    Object.keys(groups).sort().forEach(group => {
      const chans = groups[group];
      const cards = chans.map(ch => `
        <div class="card bg-gray-800/60 backdrop-blur-sm rounded-xl p-5 border border-gray-700 hover:border-purple-500/50 group">
          <div class="flex items-start gap-4">
            ${ch.logo ? `<img src="${ch.logo}" alt="${ch.name}" class="w-16 h-16 object-cover rounded-lg bg-gray-900 flex-shrink-0" onerror="this.src='https://via.placeholder.com/64?text=?'" />` : `
              <div class="w-16 h-16 bg-gray-900 rounded-lg flex items-center justify-center flex-shrink-0"><span class="text-gray-500 text-xl">TV</span></div>`}
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-lg group-hover:text-purple-300 transition-colors truncate">${ch.name}</h3>
              <p class="text-sm text-gray-400 mt-1">${group}</p>
              <div class="mt-3 flex gap-3">
                <button onclick="openPlayer('${ch.url}', '${ch.name}')" class="text-xs bg-purple-600 hover:bg-purple-700 px-3 py-1 rounded">Reproducir</button>
                <button onclick="copyToClipboard('${ch.url}')" class="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded">Copiar URL</button>
                <a href="${ch.url}" target="_blank" rel="noopener noreferrer" class="text-xs text-purple-400 hover:text-purple-300 underline truncate flex-1">${ch.url}</a>
              </div>
            </div>
          </div>
        </div>
      `).join('');

      htmlGroups += `
        <details class="mb-4">
          <summary class="bg-gray-800 p-4 rounded-xl cursor-pointer font-bold text-xl flex justify-between items-center">
            ${group} <span class="text-gray-400 text-sm">(${chans.length} canales)</span>
          </summary>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4 px-4">
            ${cards}
          </div>
        </details>
      `;
    });

    if (total === 0) {
      htmlGroups = '<p class="text-center text-gray-500 text-xl py-20">No se encontraron canales válidos</p>';
    }

    res.end(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title} – Heimdallr</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <!-- Video.js CDN -->
  <link href="https://vjs.zencdn.net/8.23.4/video-js.css" rel="stylesheet" />
  <script src="https://vjs.zencdn.net/8.23.4/video.min.js"></script>
  <!-- HLS.js CDN -->
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  <style>
    body { font-family: 'Inter', sans-serif; }
    .card { transition: all 0.3s ease; }
    .card:hover { transform: translateY(-6px); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
    #searchInput { background: #1f2937; border: 1px solid #4b5563; }
    #modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 9999; align-items: center; justify-content: center; }
    #playerContainer { width: 90%; max-width: 1200px; }
  </style>
</head>
<body class="bg-black text-white min-h-screen">
  <div class="text-center py-10">
    <h1 class="text-4xl md:text-5xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
      ${title}
    </h1>
    <p class="text-gray-400 mt-2 text-xl">${total} canales encontrados</p>
  </div>

  <div class="max-w-7xl mx-auto px-6 pb-10">
    <!-- Búsqueda -->
    <div class="mb-8">
      <input type="text" id="searchInput" onkeyup="filterChannels()" placeholder="Buscar por nombre o grupo..." class="w-full px-6 py-4 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-600 outline-none text-lg" />
    </div>

    <div id="groupsContainer">
      ${htmlGroups}
    </div>

    <div class="mt-12 text-center space-x-6">
      <a href="${basePath}" class="text-gray-400 hover:text-white px-6 py-3 border border-gray-700 rounded-xl hover:bg-gray-800 transition">← Nueva lista</a>
      <a href="/" class="text-gray-400 hover:text-white px-6 py-3 border border-gray-700 rounded-xl hover:bg-gray-800 transition">Volver al panel</a>
    </div>
  </div>

  <!-- Modal para reproductor -->
  <div id="playerModal" class="fixed inset-0 bg-black/90 hidden flex items-center justify-center z-50">
    <div class="bg-gray-900 p-6 rounded-2xl max-w-5xl w-full relative">
      <button onclick="closePlayer()" class="absolute top-4 right-4 text-white text-3xl hover:text-red-500">&times;</button>
      <h3 id="playerTitle" class="text-2xl font-bold mb-4 text-center"></h3>
      <video-js id="my-video" class="vjs-default-skin vjs-big-play-centered" controls preload="auto" width="100%" height="auto"></video-js>
    </div>
  </div>

  <script>
    let player = null;

    function openPlayer(url, name) {
      document.getElementById('playerTitle').textContent = name;
      document.getElementById('playerModal').classList.remove('hidden');

      const video = document.getElementById('my-video');
      if (player) player.dispose();
      player = videojs(video, {
        fluid: true,
        autoplay: false,
        controls: true,
        sources: [{ src: url, type: 'application/x-mpegURL' }]
      });

      // Si HLS.js es necesario (fallback para algunos browsers)
      if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(video);
      }
    }

    function closePlayer() {
      document.getElementById('playerModal').classList.add('hidden');
      if (player) {
        player.dispose();
        player = null;
      }
    }

    function copyToClipboard(text) {
      navigator.clipboard.writeText(text).then(() => {
        alert('URL copiada al portapapeles');
      }).catch(() => {
        alert('Error al copiar');
      });
    }

    function filterChannels() {
      const input = document.getElementById('searchInput').value.toLowerCase();
      const cards = document.querySelectorAll('.card');
      cards.forEach(card => {
        const name = card.querySelector('h3').textContent.toLowerCase();
        const group = card.querySelector('p').textContent.toLowerCase();
        if (name.includes(input) || group.includes(input)) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>
    `);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end(`<!-- Error HTML como antes, con basePath -->`);
  }
};
