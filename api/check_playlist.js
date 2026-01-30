const { parse } = require('@iptv/playlist');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Method Not Allowed');
  }

  const { url, xml } = req.query;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const basePath = '/comprobar';

  // Formulario solo si no hay url ni xml
  if (!url && !xml) {
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
  <div class="text-center py-12">
    <h1 class="text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
      Visor de Listas M3U
    </h1>
    <p class="text-gray-400 mt-3 text-xl">Carga tu playlist IPTV</p>
  </div>
  <div class="max-w-4xl mx-auto px-6">
    <div class="bg-gray-900/80 backdrop-blur-xl rounded-2xl shadow-2xl p-10 border border-gray-800">
      <!-- Lista única -->
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

      <!-- Multi listas -->
      <div class="mt-12 pt-8 border-t border-gray-700">
        <form action="${basePath}" method="GET" class="space-y-6">
          <div>
            <label class="block text-lg font-medium text-gray-300 mb-3">Url de XML/TXT con varias listas</label>
            <input type="url" name="xml" placeholder="https://raw.githubusercontent.com/dregs1/dregs1.github.io/main/xml/apilista.xml"
                   class="w-full px-5 py-4 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-600 focus:border-transparent text-lg" />
          </div>
          <button type="submit" class="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-bold py-4 rounded-xl transform transition-all duration-200 hover:scale-[1.02] shadow-xl text-lg">
            Cargar y Mostrar Listas
          </button>
        </form>
      </div>

      <div class="mt-10 text-center">
        <a href="/" class="text-gray-400 hover:text-purple-400 transition-colors">← Volver al panel principal</a>
      </div>
    </div>
  </div>
</body>
</html>
    `);
  }

  // Modo multi-listas (XML/TXT) - carga en la misma página
  if (xml) {
    try {
      const resp = await fetch(xml.trim(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Heimdallr/1.0)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const text = await resp.text();

      let currentGroup = 'Sin grupo';
      const grouped = {};
      text.split('\n').forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('----') || line.startsWith('//')) return;
        if (line.startsWith('name=')) {
          currentGroup = line.substring(5).trim();
          if (!grouped[currentGroup]) grouped[currentGroup] = [];
        } else if (line.startsWith('http')) {
          grouped[currentGroup].push(line);
        }
      });

      let html = '<div class="max-w-7xl mx-auto px-6 mt-12">';
      Object.keys(grouped).sort().forEach(g => {
        const lists = grouped[g];
        if (lists.length > 0) {
          html += `
            <div class="bg-gray-800/70 rounded-xl p-6 mb-8 border border-gray-700">
              <h2 class="text-2xl font-bold mb-4 text-cyan-400">${g}</h2>
              <ul class="space-y-3">
                ${lists.map((u, i) => `
                  <li class="flex items-center gap-3">
                    <span class="text-gray-400 font-medium">${i+1}.</span>
                    <a href="${basePath}?url=${encodeURIComponent(u)}"
                       class="text-purple-400 hover:text-purple-300 underline break-all flex-1">
                      ${u}
                    </a>
                  </li>
                `).join('')}
              </ul>
            </div>
          `;
        }
      });
      html += '</div>';

      if (Object.keys(grouped).length === 0) {
        html = '<p class="text-center text-gray-500 text-xl py-20">No se encontraron listas válidas en el archivo</p>';
      }

      res.end(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Listas Múltiples – Heimdallr</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>body { font-family: 'Inter', sans-serif; }</style>
</head>
<body class="bg-black text-white min-h-screen">
  <div class="text-center py-10">
    <h1 class="text-4xl md:text-5xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
      Listas Múltiples
    </h1>
  </div>
  <div class="max-w-7xl mx-auto px-6">
    ${html}
    <div class="mt-12 text-center">
      <a href="${basePath}" class="text-gray-400 hover:text-white px-6 py-3 border border-gray-700 rounded-xl hover:bg-gray-800 transition">← Volver al inicio</a>
    </div>
  </div>
</body>
</html>
      `);
    } catch (err) {
      console.error('Error multi:', err);
      res.end(`
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Error</title><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-black text-white min-h-screen flex items-center justify-center p-6">
  <div class="bg-red-950/60 p-10 rounded-2xl border border-red-800 text-center max-w-lg">
    <h2 class="text-3xl font-bold text-red-400 mb-6">Error al cargar las listas</h2>
    <p class="text-red-300 mb-8">${err.message || 'No se pudo cargar el archivo XML/TXT'}</p>
    <a href="${basePath}" class="inline-block px-10 py-5 bg-red-700 hover:bg-red-600 rounded-xl font-bold transition">Volver</a>
  </div>
</body>
</html>
      `);
    }
    return;
  }

  // Visor de canales única (sin formulario arriba)
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
    const groups = {};
    channels.forEach(ch => {
      const g = ch.group;
      if (!groups[g]) groups[g] = [];
      groups[g].push(ch);
    });
    const groupNames = Object.keys(groups).sort();
    const channelsJSON = JSON.stringify(groups);
    let htmlGroups = groupNames.map(group => `
      <details class="mb-4" data-group="${group.replace(/"/g, '&quot;')}">
        <summary class="bg-gray-800 p-4 rounded-xl cursor-pointer font-bold text-xl flex justify-between items-center">
          ${group} <span class="text-gray-400 text-sm">(${groups[group].length} canales)</span>
        </summary>
        <div class="group-content grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4 px-4"></div>
      </details>
    `).join('');
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
  <link href="https://vjs.zencdn.net/8.23.4/video-js.css" rel="stylesheet" />
  <script src="https://vjs.zencdn.net/8.23.4/video.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  <style>
    body { font-family: 'Inter', sans-serif; }
    .card { transition: all 0.3s ease; }
    .card:hover { transform: translateY(-6px); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
    #searchInput { background: #1f2937; border: 1px solid #4b5563; }
    #playerModal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 9999; align-items: center; justify-content: center; }
  </style>
</head>
<body class="bg-black text-white min-h-screen">
  <div class="max-w-7xl mx-auto px-6 pb-10">
    <div class="text-center py-10">
      <h1 class="text-4xl md:text-5xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
        ${title}
      </h1>
      <p class="text-gray-400 mt-2 text-xl">${total} canales encontrados</p>
    </div>
    <div class="mb-8">
      <input type="text" id="searchInput" onkeyup="filterChannels()" placeholder="Buscar por nombre o grupo..." class="w-full px-6 py-4 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-600 outline-none text-lg" />
    </div>
    <div id="groupsContainer">
      ${htmlGroups}
    </div>
    <div id="searchResults" class="hidden grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>
    <div class="mt-12 text-center space-x-6">
      <a href="${basePath}" class="text-gray-400 hover:text-white px-6 py-3 border border-gray-700 rounded-xl hover:bg-gray-800 transition">← Nueva lista</a>
      <a href="/" class="text-gray-400 hover:text-white px-6 py-3 border border-gray-700 rounded-xl hover:bg-gray-800 transition">Volver al panel</a>
    </div>
  </div>
  <div id="playerModal" class="fixed inset-0 bg-black/90 hidden flex items-center justify-center z-50">
    <div class="bg-gray-900 p-6 rounded-2xl max-w-5xl w-full relative">
      <button onclick="closePlayer()" class="absolute top-4 right-4 text-white text-3xl hover:text-red-500">&times;</button>
      <h3 id="playerTitle" class="text-2xl font-bold mb-4 text-center"></h3>
      <video-js id="my-video" class="vjs-default-skin vjs-big-play-centered" controls preload="auto" width="100%" height="auto"></video-js>
    </div>
  </div>
  <script>
    const channelsByGroup = ${channelsJSON};
    let player = null;

    function renderCard(ch) {
      return \`
        <div class="card bg-gray-800/60 backdrop-blur-sm rounded-xl p-5 border border-gray-700 hover:border-purple-500/50 group">
          <div class="flex items-start gap-4">
            \${ch.logo ? \` <img src="\${ch.logo}" alt="\${ch.name}" class="w-16 h-16 object-cover rounded-lg bg-gray-900 flex-shrink-0" onerror="this.src='https://via.placeholder.com/64?text=?'" /> \` : \`
              <div class="w-16 h-16 bg-gray-900 rounded-lg flex items-center justify-center flex-shrink-0"><span class="text-gray-500 text-xl">TV</span></div>\`}
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-lg group-hover:text-purple-300 transition-colors truncate">\${ch.name}</h3>
              <p class="text-sm text-gray-400 mt-1">\${ch.group}</p>
              <div class="mt-3 flex gap-3">
                <button onclick="openPlayer('\${ch.url.replace(/'/g,"\\\\'")}', '\${ch.name.replace(/'/g,"\\\\'")}')" class="text-xs bg-purple-600 hover:bg-purple-700 px-3 py-1 rounded">Reproducir</button>
                <button onclick="copyToClipboard('\${ch.url.replace(/'/g,"\\\\'")}')" class="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded">Copiar URL</button>
                <a href="\${ch.url}" target="_blank" rel="noopener noreferrer" class="text-xs text-purple-400 hover:text-purple-300 underline truncate flex-1">\${ch.url}</a>
              </div>
            </div>
          </div>
        </div>
      \`;
    }

    document.querySelectorAll('details').forEach(details => {
      details.addEventListener('toggle', (e) => {
        if (e.target.open) {
          const group = e.target.dataset.group;
          const content = e.target.querySelector('.group-content');
          if (content.innerHTML.trim() === '') {
            const html = channelsByGroup[group].map(renderCard).join('');
            content.innerHTML = html;
          }
        }
      });
    });

    function filterChannels() {
      const input = document.getElementById('searchInput').value.toLowerCase();
      const groupsContainer = document.getElementById('groupsContainer');
      const searchResults = document.getElementById('searchResults');
      if (input === '') {
        groupsContainer.classList.remove('hidden');
        searchResults.classList.add('hidden');
        searchResults.innerHTML = '';
        return;
      }
      groupsContainer.classList.add('hidden');
      searchResults.classList.remove('hidden');
      let matches = [];
      Object.keys(channelsByGroup).forEach(group => {
        matches = matches.concat(channelsByGroup[group].filter(ch =>
          ch.name.toLowerCase().includes(input) || group.toLowerCase().includes(input)
        ));
      });
      const html = matches.length > 0 ? matches.map(renderCard).join('') : '<p class="col-span-full text-center text-gray-500 text-xl py-10">No hay resultados</p>';
      searchResults.innerHTML = html;
    }

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
      navigator.clipboard.writeText(text).then(() => alert('URL copiada')).catch(() => alert('Error al copiar'));
    }
  </script>
</body>
</html>
    `);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Error</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-black text-white min-h-screen flex items-center justify-center p-6">
  <div class="bg-red-950/60 backdrop-blur-xl border border-red-800 p-10 rounded-2xl max-w-lg text-center">
    <svg class="w-20 h-20 text-red-500 mx-auto mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
    </svg>
    <h2 class="text-3xl font-bold mb-4">Error al cargar la lista</h2>
    <p class="text-red-300 mb-8">${err.message || 'URL inválida, timeout o formato no soportado'}</p>
    <a href="${basePath}" class="inline-block bg-red-700 hover:bg-red-600 text-white px-8 py-4 rounded-xl font-medium transition">Intentar otra URL</a>
  </div>
</body>
</html>
    `);
  }
};
