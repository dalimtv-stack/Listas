// src/db.js
const fetch = require("node-fetch");
const { parse } = require("iptv-playlist-parser");

// URL de la lista M3U remota
const M3U_URL = "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/shickat_list.m3u";

// Cache simple en memoria
let cachedChannels = [];

async function loadM3U() {
  try {
    console.log("Cargando lista M3U desde:", M3U_URL);
    const res = await fetch(M3U_URL);
    const content = await res.text();
    const playlist = parse(content);

    const channelsMap = {}; // Map para agrupar por tvg-id

    playlist.items.forEach((item) => {
      const id = item.tvgId || item.name; // Agrupar por tvg-id si existe
      const isAce = item.url.startsWith("acestream://");
      const isM3u8 = item.url.endsWith(".m3u8");
      const logo = item.tvgLogo || "";

      if (!channelsMap[id]) {
        // Primer stream de este canal
        channelsMap[id] = {
          id: id,
          name: item.name || id,
          logo_url: logo,
          acestream_id: isAce ? item.url.replace("acestream://", "") : null,
          m3u8_url: isM3u8 ? item.url : null,
          stream_url: (!isAce && !isM3u8) ? item.url : null,
          additional_streams: []
        };
      } else {
        // Si el logo principal estaba vacío, usar este
        if (!channelsMap[id].logo_url && logo) {
          channelsMap[id].logo_url = logo;
        }

        // Agregar streams adicionales
        channelsMap[id].additional_streams.push({
          acestream_id: isAce ? item.url.replace("acestream://", "") : null,
          m3u8_url: isM3u8 ? item.url : null,
          url: (!isAce && !isM3u8) ? item.url : null,
          logo_url: logo // opcional, útil si quieres mostrar logos alternativos
        });
      }
    });

    cachedChannels = Object.values(channelsMap);
    console.log(`Cargados ${cachedChannels.length} canales desde la lista`);
  } catch (err) {
    console.error("Error cargando M3U:", err);
    cachedChannels = [];
  }
}

// Devuelve todos los canales
async function getChannels() {
  if (cachedChannels.length === 0) {
