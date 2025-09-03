//src/db.js
const fetch = require("node-fetch");
const { parse } = require("iptv-playlist-parser");

// URL de la lista M3U remota
const M3U_URL = "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u";

// Cache simple en memoria
let cachedChannels = [];

// Función para cargar y parsear la lista M3U (con timeout)
async function loadM3U() {
  try {
    console.log("Cargando lista M3U desde:", M3U_URL);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // Timeout de 5s
    const res = await fetch(M3U_URL, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const content = await res.text();

    const playlist = parse(content);

    // Agrupar entradas por tvg-id o nombre
    const channelMap = {};

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

      // Crear objeto de stream
      const stream = {
        title: `${name} (${streamType})`,
        group_title: groupTitle,
        url: isM3u8 ? item.url : null,
        acestream_id: isAce ? item.url.replace("acestream://", "") : null,
        stream_url: (!isAce && !isM3u8) ? item.url : null
      };

      console.log(`Procesando stream: tvg-id=${tvgId}, name=${name}, group_title=${groupTitle}, url=${item.url}`);

      if (!channelMap[tvgId]) {
        // Primer stream del canal: crear entrada principal
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
        // Streams adicionales
        channelMap[tvgId].additional_streams.push(stream);
      }
    });

    // Convertir el mapa a array
    cachedChannels = Object.values(channelMap);
    console.log(`Cargados ${cachedChannels.length} canales desde la lista`);
  } catch (err) {
    console.error("Error cargando M3U:", err.message);
    cachedChannels = []; // Array vacío para evitar crashes
  }
}

// Devuelve todos los canales
async function getChannels() {
  return cachedChannels;
}

// Devuelve un canal por id
async function getChannel(id) {
  if (cachedChannels.length === 0) {
    await loadM3U();
  }
  const channel = cachedChannels.find((c) => c.id === id);
  if (!channel) {
    throw new Error(`Channel with id ${id} not found`);
  }
  return channel;
}

module.exports = {
  getChannels,
  getChannel,
  loadM3U
};
