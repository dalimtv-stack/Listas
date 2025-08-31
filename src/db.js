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

    // Agrupar canales por nombre para permitir múltiples streams
    const channelMap = {};

    playlist.items.forEach((item, index) => {
      const isAce = item.url.startsWith("acestream://");
      const isM3u8 = item.url.endsWith(".m3u8");

      const streamEntry = {
        acestream_id: isAce ? item.url.replace("acestream://", "") : null,
        m3u8_url: isM3u8 ? item.url : null,
        url: (!isAce && !isM3u8) ? item.url : null
      };

      const nameKey = item.name || `Canal ${index + 1}`;

      if (!channelMap[nameKey]) {
        // Primer canal con ese nombre
        channelMap[nameKey] = {
          id: `m3u_${Object.keys(channelMap).length}`,
          name: nameKey,
          logo_url: item.tvg.logo || "",
          acestream_id: streamEntry.acestream_id,
          m3u8_url: streamEntry.m3u8_url,
          stream_url: streamEntry.url,
          additional_streams: []
        };
      } else {
        // Ya existe un canal con este nombre: añadir stream adicional
        channelMap[nameKey].additional_streams.push(streamEntry);
      }
    });

    cachedChannels = Object.values(channelMap);
    console.log(`Cargados ${cachedChannels.length} canales (con streams múltiples) desde la lista`);
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
