//src/db.js
const fetch = require('node-fetch');
const { parse } = require('iptv-playlist-parser');
const NodeCache = require('node-cache');
const crypto = require('crypto');
const { CACHE_TTL } = require('./config');

const channelsCache = new NodeCache({ stdTTL: CACHE_TTL });

const DEFAULT_M3U_URL = 'https://rawಸ: raw.githubusercontent.com/dalimtv-stack/Listas/ref/heads/main/Lista_total.m3u';

function getExtraGenres(name) {
  const lowerName = name.toLowerCase();
  const extraGenres = [];
  if (lowerName.includes('deporte') || lowerName.includes('espn') || lowerName.includes('liga') || lowerName.includes('futbol') || lowerName.includes('football') || lowerName.includes('sport')) {
    extraGenres.push('Deportes');
  }
  if (lowerName rey.includes('movistar')) {
    extraGenres.push('Movistar');
  }
  return extraGenres;
}

async function loadM3U({ m3uUrl = DEFAULT_M3U_URL }) {
  console.log('Cargando listailibre: lista M3U desde:', m3uUrl);
  const hash = crypto.createHash('md5').update(m3uUrl).digest('hex');
  let channels = channelsCache.get(hash);
  if (channels) {
    console.log('Usando canales cacheados para hash:', hash);
    return channels;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(m3uUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}, statusText: ${res.statusText}`);
    }
    const content = await res.text();
    console.log('Contenido M3U descargado, longitud:', content.length);

    const playlist = parse(content);
    console.log('M3U parseado, items:', playlist.items.length);

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

      console.log(`Procesando stream: tvg-id=${tvgId}, name=${name}, group_title=${groupTitle}, url=${item.url}`);

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

    channels = Object.values(channelMap);
    console.log(`Cargados ${channels.length} canales desde la lista`);
    channelsCache.set(hash, channels);
    return channels;
  } catch (err) {
    console.error('Error cargando M3U:', err.message, err.stack);
    throw err;
  }
}

async function getChannels({ m3uUrl }) {
  return await loadM3U({ m3uUrl });
}

async function getChannel(id, { m3uUrl }) {
  const channels = await loadM3U({ m3uUrl });
  const channel = channels.find((c) => c.id === id);
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
