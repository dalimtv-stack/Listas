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

  /* =========================================================
     1️⃣ PANTALLA INICIAL (SOLO BOTONES)
  ========================================================= */
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
<style>body{font-family:'Inter',sans-serif}</style>
</head>
<body class="bg-black text-white min-h-screen">
<div class="text-center py-12">
  <h1 class="text-5xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
    Visor de Listas M3U
  </h1>
</div>

<div class="max-w-4xl mx-auto px-6">
  <div class="bg-gray-900/80 rounded-2xl shadow-2xl p-10 border border-gray-800">

    <!-- BOTÓN M3U (NO SE TOCA) -->
    <form action="${basePath}" method="GET" class="space-y-6">
      <label class="block text-lg text-gray-300">URL de lista M3U</label>
      <input type="url" name="url" required
        class="w-full px-5 py-4 bg-gray-800 border border-gray-700 rounded-xl text-white"/>
      <button class="w-full bg-purple-600 hover:bg-purple-700 py-4 rounded-xl font-bold">
        Cargar Canales
      </button>
    </form>

    <!-- BOTÓN XML/TXT (HUB) -->
    <div class="mt-12 pt-8 border-t border-gray-700">
      <form action="${basePath}" method="GET" class="space-y-6">
        <label class="block text-lg text-gray-300">XML / TXT con listas</label>
        <input type="url" name="xml"
          class="w-full px-5 py-4 bg-gray-800 border border-gray-700 rounded-xl text-white"/>
        <button class="w-full bg-blue-600 hover:bg-blue-700 py-4 rounded-xl font-bold">
          Explorar Listas
        </button>
      </form>
    </div>

  </div>
</div>
</body>
</html>
`);
  }

  /* =========================================================
     2️⃣ MODO HUB (XML/TXT) → GRUPOS DE LISTAS
  ========================================================= */
  if (xml) {
    try {
      const resp = await fetch(xml.trim(), {
        headers: { 'User-Agent': 'Mozilla/5.0 Heimdallr' },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const text = await resp.text();
      let currentGroup = 'Sin grupo';
      const grouped = {};

      text.split('\n').forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('//') || line.startsWith('----')) return;
        if (line.startsWith('name=')) {
          currentGroup = line.substring(5).trim();
          if (!grouped[currentGroup]) grouped[currentGroup] = [];
        } else if (line.startsWith('http')) {
          if (!grouped[currentGroup]) grouped[currentGroup] = [];
          grouped[currentGroup].push(line);
        }
      });

      let html = '<div class="max-w-7xl mx-auto px-6 mt-12">';
      Object.keys(grouped).sort().forEach(g => {
        html += `
        <div class="bg-gray-800/70 rounded-xl p-6 mb-8 border border-gray-700">
          <h2 class="text-2xl font-bold mb-4 text-cyan-400">${g}</h2>
          <ul class="space-y-3">
            ${grouped[g].map((u,i)=>`
              <li>
                <a href="${basePath}?url=${encodeURIComponent(u)}"
                   class="text-purple-400 hover:text-purple-300 underline break-all">
                  ${i+1}. ${u}
                </a>
              </li>
            `).join('')}
          </ul>
        </div>`;
      });
      html += '</div>';

      return res.end(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Listas Múltiples</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-black text-white min-h-screen">
<div class="text-center py-10">
<h1 class="text-4xl font-extrabold text-cyan-400">Listas disponibles</h1>
</div>
${html}
<div class="text-center mt-10">
<a href="${basePath}" class="text-gray-400 hover:text-white">← Volver</a>
</div>
</body>
</html>
`);
    } catch (err) {
      return res.end(`<h1>Error XML</h1><p>${err.message}</p>`);
    }
  }

  /* =========================================================
     3️⃣ MODO PLAYER (URL DIRECTA)
  ========================================================= */
  try {
    const response = await fetch(url.trim(), {
      headers: { 'User-Agent': 'Mozilla/5.0 Heimdallr' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();

    let channels = [];
    try {
      const playlist = parse(text);
      channels = playlist.items.map(item => ({
        name: item.name || 'Canal',
        url: item.url,
        group: item.attrs?.['group-title'] || 'General',
        logo: item.attrs?.['tvg-logo'] || ''
      }));
    } catch {}

    const groups = {};
    channels.forEach(ch=>{
      if(!groups[ch.group]) groups[ch.group]=[];
      groups[ch.group].push(ch);
    });

    const channelsJSON = JSON.stringify(groups);

    res.end(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Lista IPTV</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://vjs.zencdn.net/8.23.4/video-js.css" rel="stylesheet" />
<script src="https://vjs.zencdn.net/8.23.4/video.min.js"></script>
</head>
<body class="bg-black text-white min-h-screen">
<div class="max-w-7xl mx-auto px-6 pb-10">
<h1 class="text-4xl font-extrabold text-center py-8">Canales</h1>
<input id="searchInput" placeholder="Buscar..." class="w-full px-5 py-3 bg-gray-800 mb-6 rounded"/>

<div id="groups"></div>

<div class="text-center mt-10">
<a href="${basePath}" class="text-gray-400 hover:text-white">← Nueva lista</a>
</div>
</div>

<script>
const data=${channelsJSON};

function render(){
 const container=document.getElementById('groups');
 container.innerHTML='';
 Object.keys(data).forEach(g=>{
  const div=document.createElement('div');
  div.innerHTML='<h2 class="text-xl mt-6">'+g+'</h2>';
  data[g].forEach(ch=>{
   div.innerHTML+=\`<div class="p-2 border-b border-gray-800 flex justify-between">
   <span>\${ch.name}</span>
   <button onclick="play('\${ch.url}','\${ch.name}')" class="text-purple-400">▶</button>
   </div>\`;
  });
  container.appendChild(div);
 });
}

function play(url,name){
 const video=document.createElement('video');
 video.controls=true;
 video.autoplay=true;
 video.src=url;
 document.body.innerHTML='';
 document.body.appendChild(video);
}

render();
</script>
</body>
</html>
`);
  } catch (err) {
    res.end(`<h1>Error</h1><p>${err.message}</p>`);
  }
};
