// src/db.js
const fetch = require("node-fetch");
const { parse } = require("iptv-playlist-parser");

// URL de la lista M3U remota
const M3U_URL = "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/shickat_list.m3u";

// Cache simple en memoria
let cachedChannels = [];

// Función para cargar y parsear la lista M3U
async function loadM3U() {
  try {
    console.log("Cargando lista M3U desde:", M3U_URL);
    const res = await fetch(M3U_URL);
    const content = await res.text();

    const playlist = parse(content);

    // Convertir cada entrada de la lista en un canal compatible con Stremio
    cachedChannels = playlist.items.map((item, index) => {
      const isAce = item.url.startsWith("acestream://");
      const isM3u8 = item.url.endsWith(".m3u8");

      return {
        id: `m3u_${index}`,
        name: item.name || `Canal ${index + 1}`,
        logo_url: item.tvg.logo || "",
        // Si es acestream, guardamos en campo acestream_id
        acestream_id: isAce ? item.url.replace("acestream://", "") : null,
        // Si es m3u8, guardamos en m3u8_url
        m3u8_url: isM3u8 ? item.url : null,
        // Si no es ninguno de los anteriores, lo tratamos como URL normal
        stream_url: (!isAce && !isM3u8) ? item.url : null,
        additional_streams: []
      };
    });

    console.log(`Cargados ${cachedChannels.length} canales desde la lista`);
  } catch (err) {
    console.error("Error cargando M3U:", err);
    cachedChannels = [];
  }
}

// Devuelve todos los canales
async function getChannels() {
  if (cachedChannels.length === 0) {
    await loadM3U();
  }
  return cachedChannels;
}

// Devuelve un canal por id
async function getChannel(id) {
  if (cachedChannels.length === 0) {
    await loadM3U();
  }
  return cachedChannels.find((c) => c.id === id);
}

module.exports = {
  getChannels,
  getChannel,
};
