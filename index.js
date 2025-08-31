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

    // Mapeo de canales por nombre para agrupar streams múltiples
    const channelMap = {};

    playlist.items.forEach((item, index) => {
      const isAce = item.url.startsWith("acestream://");
      const isM3u8 = item.url.endsWith(".m3u8");
      const channelName = item.name || `Canal ${index + 1}`;
      const group = item.group || "Otros";

      const streamEntry = {
        title: isAce ? "AceStream" : "Stream",
        url: item.url,
        type: isAce ? "acestream" : isM3u8 ? "m3u8" : "url"
      };

      // Si el canal ya existe, agregamos stream adicional
      if (channelMap[channelName]) {
        channelMap[channelName].streams.push(streamEntry);
      } else {
        // Si no existe, lo creamos
        channelMap[channelName] = {
          id: `m3u_${index}`,
          name: channelName,
          logo_url: item.tvg.logo || "",
          group: group, // Temática para Discover
          streams: [streamEntry]
        };
      }
    });

    // Convertimos el map a array
    cachedChannels = Object.values(channelMap);

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
