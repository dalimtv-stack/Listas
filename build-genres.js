//build-genres.js
const fs = require('fs');
const { parse } = require('iptv-playlist-parser');
const fetch = require('node-fetch');

const M3U_URL = "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u";

async function generateManifest() {
  const res = await fetch(M3U_URL);
  const content = await res.text();
  const playlist = parse(content);

  const genres = new Set();
  playlist.items.forEach(item => {
    let group = item.tvg.group;
    if (!group && item.raw) {
      const match = item.raw.match(/group-title="([^"]+)"/);
      group = match?.[1] || "Sin grupo";
    }
    genres.add(group);
  });

  const manifest = {
    id: 'org.stremio.Heimdallr',
    version: '1.2.127',
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
          { name: 'genre', options: Array.from(genres).sort(), isRequired: false }
        ]
      }
    ],
    resources: ['stream', 'meta', 'catalog'],
    idPrefixes: ['heimdallr_']
  };

  fs.writeFileSync('./manifest.json', JSON.stringify(manifest, null, 2));
  console.log("manifest.json generado correctamente con géneros dinámicos.");
}

generateManifest().catch(console.error);
