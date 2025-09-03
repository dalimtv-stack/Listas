// build-genres.js
const fs = require('fs');
const { parse } = require('iptv-playlist-parser');
const fetch = require('node-fetch');

const M3U_URL = "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u";
const MANIFEST_FILE = "./manifest.json";

async function getGenres() {
  try {
    const res = await fetch(M3U_URL);
    const content = await res.text();
    const playlist = parse(content);

    const genres = new Set();
    playlist.items.forEach(item => {
      let group = item.tvg.group || "";
      if (!group && item.raw) {
        const match = item.raw.match(/group-title="([^"]+)"/);
        group = match ? match[1] : "Sin grupo";
      }
      if (group) genres.add(group);
    });

    return Array.from(genres).sort();
  } catch (err) {
    console.error("Error obteniendo géneros:", err);
    return [];
  }
}

// Generar manifest.json
(async () => {
  const genres = await getGenres();
  const manifest = {
    id: 'org.stremio.Heimdallr',
    version: '1.2.125',
    name: 'Heimdallr Channels',
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
          { name: 'genre', options: genres, isRequired: false }
        ]
      }
    ],
    resources: ['stream', 'meta', 'catalog'],
    idPrefixes: ['heimdallr_']
  };

  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  console.log(`manifest.json generado con ${genres.length} géneros.`);
})();
