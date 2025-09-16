// src/db.js
const fetch = require('node-fetch');
const { parse } = require('iptv-playlist-parser');

let cachedChannels = [];
const DEFAULT_M3U_URL = 'https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u';

function getExtraGenres(name) {
  const lowerName = name.toLowerCase();
  const extraGenres = [];
  if (lowerName.includes('deporte') || lowerName.includes('formula 1') || lowerName.includes('bein') || lowerName.includes('F1') || lowerName.includes('dazn') || lowerName.includes('nba') || lowerName.includes('espn') || lowerName.includes('liga') || lowerName.includes('futbol') || lowerName.includes('football') || lowerName.includes('sport')) {
    extraGenres.push('Deportes');
  }
  if (lowerName.includes('movistar')) {
    extraGenres.push('Movistar');
  }
  if (lowerName.includes('dazn')) {
    extraGenres.push('Dazn');
  }
  if (lowerName.includes('espn')) {
    extraGenres.push('ESPN');
  }
  if (lowerName.includes('campeones')) {
    extraGenres.push('Liga de Campeones');
  }
  return extraGenres;
}

async function loadM3U(args = {}) {
  const m3uUrl = args.m3uUrl || DEFAULT_M3U_URL;
  console.log(`[loadM3U] Cargando lista M3U desde: ${m3uUrl}`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    console.log(`[loadM3U] Enviando solicitud HTTP a: ${m3uUrl}`);
    const res = await fetch(m3uUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    console.log(`[loadM3U] Respuesta HTTP: status=${res.status}, statusText=${res.statusText}`);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}, statusText: ${res.statusText}`);
    }
    const content = await res.text();
    console.log(`[loadM3U] Contenido M3U descargado, longitud: ${content.length}, primeros 100 caracteres: ${content.slice(0, 100)}`);

    if (!content || content.trim() === '') {
      throw new Error('Contenido M3U vacío');
    }

    let playlist;
    try {
      playlist = parse(content);
    } catch (err) {
      throw new Error(`Error parseando M3U: ${err.message}`);
    }
    console.log(`[loadM3U] M3U parseado, items: ${playlist.items.length}`);
    if (playlist.items.length === 0) {
      throw new Error('La lista M3U no contiene elementos válidos');
    }

    const channelMap = {};

    playlist.items.forEach((item, index) => {
      const tvgId = item.tvg.id || item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || `channel_${index}`;
      const isAce = item.url.startsWith('acestream://');
      const isM3u8 = item.url.endsWith('.m3u8');

      const streamType = isAce ? 'Acestream' : isM3u8 ? 'M3U8' : 'Browser';

      let name = item.name || '';
      if (!name && item.raw) {
        const match = item.raw.match(/,([^,]+)/);
        name = match ? match[1].trim() : `Canal ${index + 1}`;
      }

      let groupTitle = item.tvg.group || '';
      if (!groupTitle && item.raw) {
        const groupMatch = item.raw.match(/group-title="([^"]+)"/);
        groupTitle = groupMatch ? groupMatch[1] : 'Sin grupo';
      }

      const stream = {
        title: `${name} (${streamType})`,
        group_title: groupTitle,
        url: isM3u8 ? item.url : null,
        acestream_id: isAce ? item.url.replace('acestream://', '') : null,
        stream_url: (!isAce && !isM3u8) ? item.url : null
      };

      //console.log(`[loadM3U] Procesando stream: tvg-id=${tvgId}, name=${name}, group_title=${groupTitle}, url=${item.url}`);

      if (!channelMap[tvgId]) {
        channelMap[tvgId] = {
          id: tvgId,
          name: name || `Canal ${index + 1}`,
          logo_url: item.tvg.logo || '',
          group_title: groupTitle,
          acestream_id: stream.acestream_id,
          m3u8_url: stream.url,
          stream_url: stream.stream_url,
          website_url: null,
          title: stream.title,
          additional_streams: [stream],
          extra_genres: getExtraGenres(name)
        };
      } else {
        channelMap[tvgId].additional_streams.push(stream);
      }
    });

    cachedChannels = Object.values(channelMap);
    console.log(`[loadM3U] Cargados ${cachedChannels.length} canales desde la lista`);
    return cachedChannels;
  } catch (err) {
    console.error(`[loadM3U] Error cargando M3U desde ${m3uUrl}: ${err.message}`, err.stack);
    cachedChannels = [];
    throw err;
  }
}

async function getChannels(args = {}) {
  const m3uUrl = args.m3uUrl || DEFAULT_M3U_URL;
  console.log(`[getChannels] Llamado con m3uUrl: ${m3uUrl}`);
  await loadM3U({ m3uUrl });
  return cachedChannels;
}

async function getChannel(id, args = {}) {
  const m3uUrl = args.m3uUrl || DEFAULT_M3U_URL;
  console.log(`[getChannel] Llamado con m3uUrl: ${m3uUrl}, id: ${id}`);
  await loadM3U({ m3uUrl });
  const channel = cachedChannels.find((c) => c.id === id);
  if (!channel) {
    throw new Error(`Channel with id ${id} not found`);
  }
  console.log(`[getChannel] Canal encontrado: ${channel.name}`);
  return channel;
}

module.exports = {
  getChannels,
  getChannel,
  loadM3U
};
