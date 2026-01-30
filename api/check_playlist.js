const { parse } = require('@iptv/playlist');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Method Not Allowed');
  }

  const { url, xml } = req.query;  // Añadido ?xml para multi-listas
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const basePath = '/comprobar';

  // Formulario base, ahora con input y botón para XML/TXT
  const formHtml = `
  <div class="bg-gray-900/80 backdrop-blur-xl rounded-2xl shadow-2xl p-10 border border-gray-800">
    <form action="${basePath}" method="GET" class="space-y-6">
      <div>
        <label class="block text-lg font-medium text-gray-300 mb-3">URL de la lista (.m3u / .m3u8)</label>
        <input type="url" name="url" placeholder="https://example.com/iptv.m3u8"
               class="w-full px-5 py-4 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-600 focus:border-transparent text-lg" />
      </div>
      <button type="submit" class="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-4 rounded-xl transform transition-all duration-200 hover:scale-[1.02] shadow-xl text-lg">
        Cargar y Mostrar Canales
      </button>
    </form>
    <form action="${basePath}" method="GET" class="space-y-6 mt-8">
      <div>
        <label class="block text-lg font-medium text-gray-300 mb-3">Url de XML/TXT con varias listas</label>
        <input type="url" name="xml" placeholder="https://raw.githubusercontent.com/dregs1/dregs1.github.io/main/xml/apilista.xml"
               class="w-full px-5 py-4 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-600 focus:border-transparent text-lg" />
      </div>
      <button type="submit" class="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-bold py-4 rounded-xl transform transition-all duration-200 hover:scale-[1.02] shadow-xl text-lg">
        Cargar y Mostrar Listas
      </button>
    </form>
    <div class="mt-10 text-center">
      <a href="/" class="text-gray-400 hover:text-purple-400 transition-colors">← Volver al panel principal</a>
    </div>
  </div>
  `;

  // Si no hay params, mostrar solo formulario
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
  <div class="max-w-3xl mx-auto px-6">
    ${formHtml}
  </div>
</body>
</html>
    `);
  }

  try {
    let contentHtml = '';

    if (xml) {
      // Modo multi: Cargar TXT/XML y mostrar listas clickable
      const response = await fetch(xml.trim(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Heimdallr/1.0)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} - ${response.statusText}`);

      const text = await response.text();

      // Parsear el texto: grupos con name= y URLs
      let currentGroup = 'Listas sin grupo';
      const grouped = {};
      text.split('\n').forEach(line => {
        line = line.trim();
        if (line.startsWith('name=')) {
          currentGroup = line.slice(5).trim();
          if (!grouped[currentGroup]) grouped[currentGroup] = [];
        } else if (line.startsWith('http')) {
          if (!grouped[currentGroup]) grouped[currentGroup] = [];
          grouped[currentGroup].push(line);
        }
      });

      // Generar HTML para grupos de listas clickable
      contentHtml = '<div class="mt-12">';
      Object.keys(grouped).sort().forEach(group => {
        const lists = grouped[group];
        if (lists.length > 0) {
          contentHtml += `
            <h2 class="text-2xl font-bold mb-4 bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">${group}</h2>
            <ul class="space-y-2 mb-8">
              ${lists.map((listUrl, index) => `
                <li>
                  <a href="${basePath}?url=${encodeURIComponent(listUrl)}" class="text-purple-400 hover:text-purple-300 underline block truncate">
                    Lista ${index + 1}: ${listUrl}
                  </a>
                </li>
              `).join('')}
            </ul>
          `;
        }
      });
      contentHtml += '</div>';

      if (Object.keys(grouped).length === 0) {
        contentHtml = '<p class="text-center text-gray-500 text-xl py-20">No se encontraron listas válidas en el archivo</p>';
      }
    } else if (url) {
      // Modo single: Cargar canales (código anterior sin cambios)
      const response = await fetch(url.trim(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Heimdallr/1.0)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      let channels = [];
      try {
        const playlist = parse(text);
        channels = playlist.items
          .filter(item => item.url && item.url.startsWith('http'))
          .map(item => ({
            name: item.name?.trim() || item.attrs?.title || 'Canal sin nombre',
            url: item.url,
            logo: item.attrs?.['tvg-logo'] || '',
            group: item.attrs?.['group-title'] || 'Sin categoría',
          }));
      } catch (parseErr) {
        console.error('Error parseando con @iptv/playlist:', parseErr);
      }
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
      let htmlChannels = channels.length === 0
        ? '<p class="text-center col-span-full text-gray-500 text-xl py-20">No se encontraron canales válidos en la lista</p>'
        : channels.map(ch => `
          <div class="card bg-gray-800/60 backdrop-blur-sm rounded-xl p-5 border border-gray-700 hover:border-purple-500/50 group">
            <div class="flex items-start gap-4">
              ${ch.logo ? `
                <img
                  src="${ch.logo}"
                  alt="${ch.name}"
                  class="w-16 h-16 object-cover rounded-lg bg-gray-900 flex-shrink-0"
                  onerror="this.src='https://via.placeholder.com/64?text=?'"
                />
              ` : `
                <div class="w-16 h-16 bg-gray-900 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span class="text-gray-500 text-xl">TV</span>
                </div>
              `}
              <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-lg group-hover:text-purple-300 transition-colors truncate">
                  ${ch.name}
                </h3>
                <p class="text-sm text-gray-400 mt-1">${ch.group}</p>
                <a
                  href="${ch.url}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mt-3 inline-block text-xs text-purple-400 hover:text-purple-300 underline truncate max-w-full block"
                >
                  ${ch.url}
                </a>
              </div>
            </div>
          </div>
        `).join('');
      contentHtml = `
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          ${htmlChannels}
        </div>
      `;
    }

    res.end(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${xml ? 'Listas Multiples' : 'Lista IPTV'} – Heimdallr</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
    .card { transition: all 0.3s ease; }
    .card:hover { transform: translateY(-6px); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
  </style>
</head>
<body class="bg-black text-white min-h-screen">
  <div class="text-center py-10">
    <h1 class="text-4xl md:text-5xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
      ${xml ? 'Listas Múltiples' : 'Visor de Listas M3U'}
    </h1>
    <p class="text-gray-400 mt-2 text-xl">${xml ? Object.values(grouped).reduce((acc, arr) => acc + arr.length, 0) : channels.length} elementos encontrados</p>
  </div>
  <div class="max-w-7xl mx-auto px-6 pb-20">
    ${formHtml}  <!-- Siempre mostrar formulario arriba -->
    ${contentHtml}  <!-- Contenido debajo -->
    <div class="mt-12 text-center">
      <a href="${basePath}" class="text-gray-400 hover:text-white px-6 py-3 border border-gray-700 rounded-xl hover:bg-gray-800 transition">← Nueva búsqueda</a>
      <a href="/" class="ml-4 text-gray-400 hover:text-white px-6 py-3 border border-gray-700 rounded-xl hover:bg-gray-800 transition">Volver al panel</a>
    </div>
  </div>
</body>
</html>
    `);
  } catch (err) {
    console.error('Error:', err);
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
    <h2 class="text-3xl font-bold mb-4">Error al cargar</h2>
    <p class="text-red-300 mb-8">${err.message || 'URL inválida o formato no soportado'}</p>
    <a href="${basePath}" class="inline-block bg-red-700 hover:bg-red-600 text-white px-8 py-4 rounded-xl font-medium transition">Intentar otra</a>
  </div>
</body>
</html>
    `);
  }
};
