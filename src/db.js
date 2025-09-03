//src/db.js
const fetch = require("node-fetch");
const { parse } = require("iptv-playlist-parser");

const M3U_URL = "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u";

let cachedChannels = [];

async function loadM3U() {
  try {
    console.log("Cargando lista M3U desde:", M3U_URL);
    const res = await fetch(M3U_URL);
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
        const groupMatch = item.raw.match(/group-title="([^"]+)"/);
        groupTitle = groupMatch ? groupMatch[1] : "Sin grupo";
      }

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
          name,
          logo_url: item.tvg.logo || "",
          group_title,
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
    console.log(`Cargados ${cachedChannels.length} canales`);
  } catch (err) {
    console.error("Error cargando M3U:", err);
    cachedChannels = [];
  }
}

async function getChannels() {
  if (cachedChannels.length === 0) await loadM3U();
  return cachedChannels;
}

async function getChannel(id) {
  if (cachedChannels.length === 0) await loadM3U();
  const channel = cachedChannels.find(c => c.id === id);
  if (!channel) throw new Error(`Channel with id ${id} not found`);
  return channel;
}

async function getGenres() {
  if (cachedChannels.length === 0) await loadM3U();
  const genresSet = new Set();
  cachedChannels.forEach(c => {
    if (c.group_title) genresSet.add(c.group_title);
    if (c.additional_streams) c.additional_streams.forEach(s => s.group_title && genresSet.add(s.group_title));
  });
  return Array.from(genresSet).sort();
}

module.exports = { getChannels, getChannel, getGenres };
