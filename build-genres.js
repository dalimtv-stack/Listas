// build-genres.js
const fs = require('fs');
const path = require('path');
const { parse } = require('iptv-playlist-parser');
const { STREAM_PREFIX, ADDON_ID, ADDON_NAME } = require('./src/config');

// URL de tu lista
const M3U_URL = 'https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u';

async function fetchText(url) {
  // usa fetch si está disponible (Node >=18), sino https
  if (typeof fetch === 'function') {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    return await res.text();
  }
  return new Promise((resolve, reject) => {
    const https = require('https');
    https.get(url, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

(async () => {
  try {
    console.log('Descargando M3U desde:', M3U_URL);
    const content = await fetchText(M3U_URL);
    const playlist = parse(content);

    const genresSet = new Set();
    playlist.items.forEach(item => {
      let group = (item.tvg && item.tvg.group) || '';
      if (!group && item.raw) {
        const m = item.raw.match(/group-title="([^"]+)"/);
        if (m) group = m[1];
      }
      group = (group || 'Sin grupo').trim();
      if (group) genresSet.add(group);
    });

    const genreOptions = Array.from(genresSet).sort();
    console.log('Géneros encontrados:', genreOptions);

    const manifest = {
      id: ADDON_ID || 'org.stremio.Heimdallr',
      version: '1.3.000',
      name: ADDON_NAME || 'Heimdallr Channels',
      description: 'Addon para cargar canales Acestream o M3U8 desde una lista M3U.',
      types: ['tv'],
      logo: "https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960",
      catalogs: [
        {
          type: 'tv',
          id: 'Heimdallr',
          name: 'Heimdallr Live Channels',
          extra: [
            { name: 'search' },
            { name: 'genre', options: genreOptions }
          ]
        }
      ],
      resources: ['stream', 'meta', 'catalog'],
      idPrefixes: [STREAM_PREFIX || 'heimdallr_']
    };

    const outPath = path.join(__dirname, 'manifest.json');
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log('✅ manifest.json generado en', outPath);
  } catch (err) {
    console.error('❌ Error generando manifest:', err);
    process.exit(1);
  }
})();
