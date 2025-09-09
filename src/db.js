// src/db.js
const fetch = require('node-fetch');
const { parse } = require('iptv-playlist-parser');
const NodeCache = require('node-cache');
const crypto = require('crypto');
const { CACHE_TTL } = require('./config');

const channelsCache = new NodeCache({ stdTTL: CACHE_TTL });

const DEFAULT_M3U_URL = 'https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u';

function getExtraGenres(name) {
  const lowerName = name.toLowerCase();
  const extraGenres = [];
  if (lowerName.includes('deporte') || lowerName.includes('espn') || lowerName.includes('liga') || lowerName.includes('futbol') || lowerName.includes('football') || lowerName.includes('sport')) {
    extraGenres.push('Deportes');
  }
  if (lowerName.includes('movistar')) extraGenres.push('Movistar');
  return extraGenres;
}

async function loadM3U({ m3uUrl = DEFAULT_M3U_URL }) {
  const hash = crypto.createHash('md5').update(m3uUrl).digest('hex');
  let channels = channelsCache.get(hash);
  if (channels) return channels;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(m3uUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

    const content = await res.text();
    const playlist = parse(content);

    const channelMap = {};
    playlist.items.forEach((item, index) => {
      const tvgId = item.tvg.id || item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || `channel_${index}`;
      const isAce = item.url.startsWith('acestream://');
      const isM3u8 = item.url.endsWith('.m3u8');

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
        title: `${name} (${isAce ? 'Acestream' : isM3u8 ? 'M3U8' : 'Browser'})`,
        group_title: groupTitle,
        url: isM3u8 ? item.url : null,
        acestream_id: isAce ? item.url.replace('acestream://', '') : null,
        stream_url: (!isAce && !isM3u8) ? item.url : null
      };

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
    channelsCache.set(hash, channels);
    return channels;

  } catch (err) {
    console.error('Error cargando M3U:', err);
    throw err;
  }
}

async function getChannels({ m3uUrl }) {
  return await loadM3U({ m3uUrl });
}

async function getChannel(id, { m3uUrl }) {
  const channels = await loadM3U({ m3uUrl });
  const channel = channels.find(c => c.id === id);
  if (!channel) throw new Error(`Channel with id ${id} not found`);
  return channel;
}

module.exports = {
  getChannels,
  getChannel,
  loadM3U
};
