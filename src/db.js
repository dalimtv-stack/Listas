const fetch = require("node-fetch");
const { parse } = require("iptv-playlist-parser");

const DEFAULT_M3U_URL = "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u";

// Cache simple en memoria
let cachedChannels = [];

async function loadM3U(url = DEFAULT_M3U_URL) {
  try {
    console.log("Cargando lista M3U desde:", url);
    const res = await fetch(url);
    const content = await res.text();

    const playlist = parse(content);

    const channelMap = {};

    playlist.items.forEach((item, index) => {
      const tvgId = item.tvg.id || item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || `channel_${index}`;
      const isAce = item.url.startsWith("acestream://");
      const isM3u8 = item.url.endsWith(".m3u8");

      const streamType = isAce ? "Acestream" : isM3u8 ? "M3U8" : "Browser";

      let name = item.name || "";
      if (!name && item.raw) {
        const match = item.raw.match(/,([^,]+)/);
        name = match ? match[1].trim() : `Canal ${index + 1}`;
      }

      let groupTitle = item.tvg.group || "";
      if (!groupTitle && item.raw) {
        const groupMatch = item.raw.match(/group-title="([^"]+)"/i); // Insensible a mayúsculas
        groupTitle = groupMatch ? groupMatch[1] : "Default Group";
      }
      console.log(`Procesando: tvg-id=${tvgId}, name=${name}, group_title=${groupTitle}, title=${item.name} (${streamType}), url=${item.url}`); // Depuración mejorada

      const stream = {
        title: `${item.name || name} (${streamType})`, // Usar el nombre original con el tipo
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
    console.log(`Cargados ${cachedChannels.length} canales desde la lista`);
    return cachedChannels;
  } catch (err) {
    console.error("Error cargando M3U:", err);
    return [];
  }
}

// Devuelve todos los canales
async function getChannels(url = DEFAULT_M3U_URL) {
  if (cachedChannels.length === 0) {
    cachedChannels = await loadM3U(url);
  }
  return cachedChannels;
}

// Devuelve un canal por id
async function getChannel(id, url = DEFAULT_M3U_URL) {
  if (cachedChannels.length === 0) {
    cachedChannels = await loadM3U(url);
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
