const fetch = require("node-fetch");
const { parse } = require("iptv-playlist-parser");

// URL de la lista M3U remota
const M3U_URL = "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u";

// Cache simple en memoria
let cachedChannels = [];

// Función para cargar y parsear la lista M3U
async function loadM3U() {
  try {
    console.log("Cargando lista M3U desde:", M3U_URL);
    const res = await fetch(M3U_URL);
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

      // Crear objeto de stream con título basado en item.name y tipo
      const stream = {
        title: `${item.name} (${streamType})`, // Usar el nombre del stream con tipo
        url: isM3u8 ? item.url : null,
        acestream_id: isAce ? item.url.replace("acestream://", "") : null,
        stream_url: (!isAce && !isM3u8) ? item.url : null
      };

      if (!channelMap[tvgId]) {
        // Primer stream del canal: crear entrada principal
        channelMap[tvgId] = {
          id: tvgId,
          name: item.name || `Canal ${index + 1}`,
          logo_url: item.tvg.logo || "",
          group_title: item.tvg.group || "",
          acestream_id: stream.acestream_id,
          m3u8_url: stream.url,
          stream_url: stream.stream_url,
          website_url: null,
          title: stream.title,
          additional_streams: []
        };
      } else {
        // Streams adicionales: añadir con título basado en item.name
        channelMap[tvgId].additional_streams.push(stream);
      }
    });

    // Convertir el mapa a array
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
  const channel = cachedChannels.find((c) => c.id === id);
  if (!channel) {
    throw new Error(`Channel with id ${id} not found`);
  }
  return channel;
}

module.exports = {
  getChannels,
  getChannel,
};
