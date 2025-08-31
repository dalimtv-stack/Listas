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

    const channelsMap = {};

    playlist.items.forEach((item, index) => {
      const tvgId = item.tvgId || item.name || `m3u_${index}`;
      const isAce = item.url.startsWith("acestream://");
      const isM3u8 = item.url.endsWith(".m3u8");
      const logo = item.tvgLogo || "";

      if (!channelsMap[tvgId]) {
        // Primer stream de este canal
        channelsMap[tvgId] = {
          id: `m3u_${index}`,
          name: item.name || `Canal ${index + 1}`,
          logo_url: logo,
          acestream_id: isAce ? item.url.replace("acestream://", "") : null,
          m3u8_url: isM3u8 ? item.url : null,
          stream_url: (!isAce && !isM3u8) ? item.url : null,
          additional_streams: []
        };
      } else {
        // Si el canal ya existe, agregamos a additional_streams
        channelsMap[tvgId].additional_streams.push({
          acestream_id: isAce ? item.url.replace("acestream://", "") : null,
          m3u8_url: isM3u8 ? item.url : null,
          url: (!isAce && !isM3u8) ? item.url : null,
          logo_url: logo // opcional, para referencias internas
        });

        // Si el logo principal estaba vacío, usar el nuevo
        if (!channelsMap[tvgId].logo_url && logo) {
          channelsMap[tvgId].logo_url = logo;
        }
      }
    });

    cachedChannels = Object.values(channelsMap);
    console.log(`Cargados ${cachedChannels.length} canales agrupados desde la lista`);
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
