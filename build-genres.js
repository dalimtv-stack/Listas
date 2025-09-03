// build-genres.js
const fs = require('fs');
const { parse } = require('iptv-playlist-parser');
const fetch = require('node-fetch');

const M3U_URL = "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u";

async function buildManifest() {
  try {
    const res = await fetch(M3U_URL);
    const content = await res.text();
    const playlist = parse(content);

    const genresSet = new Set();
    playlist.items.forEach(item => {
      const groupTitle = item.tvg.group || item.raw?.match(/group-title="([^"]+)"/)?.[1];
      if (groupTitle) genresSet.add(groupTitle);
    });

    const manifest = {
      id: "org.stremio.Heimdallr",
      version: "1.2.125",
      name: "Heimdallr Channels",
      description: "Addon para cargar canales Acestream o M3U8 desde una lista M3U.",
      types: ["tv"],
      logo: "https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960",
      catalogs: [
        {
          type: "tv",
          id: "Heimdallr",
          name: "Heimdallr Live Channels",
          extra: [
            { name: "search" },
            { name: "genre", options: Array.from(genresSet).map(g => ({ name: g })), isRequired: false }
          ]
        }
      ],
      resources: ["stream", "meta", "catalog"],
      idPrefixes: ["heimdallr_"]
    };

    fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));
    console.log('manifest.json generado correctamente.');
  } catch (err) {
    console.error('Error generando manifest:', err);
  }
}

buildManifest();
