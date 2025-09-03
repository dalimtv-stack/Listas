// build-genres.js
const fs = require('fs');
const fetch = require('node-fetch');
const { parse } = require('iptv-playlist-parser');
const { ADDON_ID, ADDON_NAME, STREAM_PREFIX } = require('./src/config');

const M3U_URL = "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u";

(async () => {
  try {
    console.log("Descargando lista M3U...");
    const res = await fetch(M3U_URL);
    const content = await res.text();
    const playlist = parse(content);

    // Extraer todos los group-title únicos
    const genresSet = new Set();
    playlist.items.forEach(item => {
      let group = item.tvg.group || '';
      if (!group && item.raw) {
        const match = item.raw.match(/group-title="([^"]+)"/);
        group = match ? match[1] : '';
      }
      if (group) genresSet.add(group);
    });

    const genres = Array.from(genresSet).sort();

    // Generar manifest.json
    const manifest = {
      id: ADDON_ID,
      version: "1.2.125",
      name: ADDON_NAME,
      description: "Addon para cargar canales Acestream o M3U8 desde una lista M3U.",
      types: ["tv"],
      logo: "https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960",
      catalogs: [
        {
          type: 'tv',
          id: 'Heimdallr',
          name: 'Heimdallr Live Channels',
          extra: [
            { name: 'search' },
            { name: 'genre', options: genres, isRequired: false }
          ]
        }
      ],
      resources: ["stream","meta","catalog"],
      idPrefixes: [STREAM_PREFIX]
    };

    fs.writeFileSync('./manifest.json', JSON.stringify(manifest, null, 2));
    console.log("✅ manifest.json generado con géneros dinámicos.");
  } catch (err) {
    console.error("❌ Error generando manifest.json:", err);
    process.exit(1);
  }
})();
