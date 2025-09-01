const fetch = require("node-fetch");
const { parse } = require("iptv-playlist-parser");

// cache en memoria por URL de M3U
// { [m3uUrl: string]: Array<Channel> }
const cacheByUrl = Object.create(null);

/**
 * Carga y parsea una M3U desde `url` y devuelve un array de canales consolidados
 * preservando group-title y generando títulos por tipo de stream (M3U8/Acestream/Browser).
 */
async function loadM3U(url) {
  console.log("Cargando lista M3U desde:", url);
  const res = await fetch(url, { timeout: 20000 });
  if (!res.ok) throw new Error(`Error al descargar M3U: ${res.status} ${res.statusText}`);
  const content = await res.text();

  const playlist = parse(content);

  const channelMap = {};
  playlist.items.forEach((item, index) => {
    const raw = item.raw || "";
    const nameFromRaw = (() => {
      const m = raw.match(/,([^,\r\n]+)/);
      return m ? m[1].trim() : null;
    })();

    const tvgId =
      (item.tvg && item.tvg.id) ||
      (item.name ? slugify(item.name) : null) ||
      (nameFromRaw ? slugify(nameFromRaw) : null) ||
      `channel_${index}`;

    const channelName = item.name || nameFromRaw || `Canal ${index + 1}`;

    // group-title (case-insensitive; parser suele dar item.group.title)
    let groupTitle =
      (item.group && item.group.title) ||
      (item.tvg && item.tvg.group) ||
      matchGroupTitle(raw) ||
      "Default Group";

    // tipo de stream
    const isAce = typeof item.url === "string" && item.url.startsWith("acestream://");
    const isM3u8 = typeof item.url === "string" && item.url.toLowerCase().includes(".m3u8");
    const streamType = isAce ? "ACESTREAM" : isM3u8 ? "M3U8" : "BROWSER";

    const stream = {
      title: `${groupTitle} · ${channelName} • ${streamType}`,
      group_title: groupTitle,
      url: isM3u8 ? item.url : null,
      acestream_id: isAce ? item.url.replace("acestream://", "") : null,
      stream_url: !isAce && !isM3u8 ? item.url : null
    };

    if (!channelMap[tvgId]) {
      channelMap[tvgId] = {
        id: tvgId,
        name: channelName,
        logo_url: (item.tvg && item.tvg.logo) || "",
        group_title: groupTitle,
        // Campos “principales” por compatibilidad (no los necesitas si iteras additional_streams)
        acestream_id: stream.acestream_id,
        m3u8_url: stream.url,
        stream_url: stream.stream_url,
        website_url: null,
        title: stream.title,
        // Importante: incluimos también el primer stream aquí
        additional_streams: [stream]
      };
    } else {
      channelMap[tvgId].additional_streams.push(stream);
      // si no hay group_title definido aún y el nuevo lo trae, actualizamos
      if (!channelMap[tvgId].group_title && groupTitle) channelMap[tvgId].group_title = groupTitle;
    }
  });

  const channels = Object.values(channelMap);
  console.log(`Cargados ${channels.length} canales desde la lista`);
  cacheByUrl[url] = channels;
  return channels;
}

/** Obtiene todos los canales para una URL dada (usa cache en memoria). */
async function getChannels(url) {
  if (!url) throw new Error("No se ha configurado la URL de la lista M3U.");
  if (!cacheByUrl[url]) {
    await loadM3U(url);
  }
  return cacheByUrl[url];
}

/** Obtiene un canal por id para una URL dada. */
async function getChannel(id, url) {
  const channels = await getChannels(url);
  const channel = channels.find((c) => c.id === id);
  if (!channel) throw new Error(`Channel with id ${id} not found`);
  return channel;
}

// utils
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function matchGroupTitle(raw) {
  const m = raw.match(/group-title="([^"]+)"/i);
  return m ? m[1] : null;
}

module.exports = { getChannels, getChannel };
