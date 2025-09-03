// build-genres.js
const fs = require("fs");
const fetch = require("node-fetch");
const { parse } = require("iptv-playlist-parser");

const M3U_URL = "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u";

async function buildManifest() {
  console.log("Descargando lista M3U...");
  const res = await fetch(M3U_URL);
  const content = await res.text();
  const playlist = parse(content);

  // Extraer group-title únicos
  const genres = new Set();
  playlist.items.forEach((item) => {
    let groupTitle = item.tvg.group || "";
    if (!groupTitle && item.raw) {
      const match = item.raw.match(/group-title="([^"]+)"/);
      groupTitle = match ? match[1] : "Sin grupo";
    }
    genres.add(groupTitle);
  });

  const genreOptions = Array.from(genres).sort();

  console.log("Géneros encontrados:", genreOptions);

  // Construir manifest con los géneros
  const manifest = {
    id: 'org.stremio.Heimdallr',
    version: '1.2.123',
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
          { name: 'genre', options: genreOptions }
        ]
      }
    ],
    resources: ['stream', 'meta', 'catalog'],
    idPrefixes: ['heimdallr_']
  };

  fs.writeFileSync("manifest.json", JSON.stringify(manifest, null, 2));
  console.log("✅ Manifest generado en manifest.json");
}

buildManifest().catch(err => {
  console.error("Error generando manifest:", err);
  process.exit(1);
});
