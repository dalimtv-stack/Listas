//src/db.js
const fetch = require("node-fetch");
const { parse } = require("iptv-playlist-parser");

// URL de la lista M3U remota
const M3U_URL = "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u";

// Cache simple en memoria
let cachedChannels = [];
let cachedGenres = [];

// Función para cargar y parsear la lista M3U
async function loadM3U() {
  try {
    console.log("Cargando lista M3U desde:", M3U_URL);
    const res = await fetch(M3U_URL);
    const content = await res.text();

    const playlist = parse(content);

    // Agrupar entradas por tvg-id o nombre
    const channelMap = {};
    const genresSet = new Set();

    playlist.items.forEach((item, index) => {
      const tvgId = item.tvg.id || item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || `channel_${index}`;
      const isAce = item.url.startsWith("acestream://");
      const isM3u8 = item.url.endsWith(".m3u8");

      // Determinar tipo de stream
      const streamType = isAce ? "Acestream" : isM3u8 ? "M3U8" : "Browser";

      // Corrección manual del name si el parser falla
      let name = item.name || "";
      if (!name && item.raw) {
        const match = item.raw.match(/,([^,]+)/);
        name = match ? match[1].trim() : `Canal ${index + 1}`;
      }

      // Corrección manual del group-title si no se extrae
      let groupTitle = item.tvg.group || "";
      if (!groupTitle && item.raw) {
        const groupMatch = item.raw.match(/group-title="([^"]+)"/);
        groupTitle = groupMatch ? groupMatch[1] : "Sin grupo";
      }
      genresSet.add(groupTitle);

      // Crear objeto de stream
      const stream = {
        title: `${name} (${streamType})`,
        group_title: groupTitle,
        url: isM3u8 ? item.url : null,
        acestream_id: isAce ? item.url.replace("acestream://", "") : null,
        stream_url: (!isAce && !isM3u8) ? item.url : null
      };

      if (!channelMap[tvgId]) {
        channelMap[tvgId] = {
          id: tvgId,
          name: name || `Canal ${index + 1}`,
          logo_url: item.tvg.logo || "",
          group_title: groupTitle,
          acestream_id: stream.acestream_id,
          m3u8_url: stream.url,
          stream_url: stream.stream_url,
          website_url: null,
          title: stream.title,
          additional_streams: [stream]
        };
      } else {
        channelMap[tvgId].additional_streams.push(stream);
      }
    });

    cachedChannels = Object.values(channelMap);
    cachedGenres = Array.from(genresSet).sort();

    console.log(`Cargados ${cachedChannels.length} canales.`);
    console.log(`Géneros disponibles: ${cachedGenres.join(", ")}`);
  } catch (err) {
    console.error("Error cargando M3U:", err);
    cachedChannels = [];
    cachedGenres = [];
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
  const channel = cachedChannels.find((c) => c.id === id);
  if (!channel) throw new Error(`Channel with id ${id} not found`);
  return channel;
}

// Devuelve la lista de géneros
function getGenres() {
  return cachedGenres;
}

module.exports = { getChannels, getChannel, getGenres, loadM3U };
