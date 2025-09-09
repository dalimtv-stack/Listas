// src/db.js
const fetch = require('node-fetch');
const { parse } = require('iptv-playlist-parser');
const NodeCache = require('node-cache');
const crypto = require('crypto');
const { CACHE_TTL } = require('../src/config') || require('./config');

const channelsCache = new NodeCache({ stdTTL: CACHE_TTL || 300 });

const DEFAULT_M3U_URL = 'https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u';

function getExtraGenres(name) {
  const lowerName = (name || '').toLowerCase();
  const extraGenres = [];
  if (lowerName.includes('deporte') || lowerName.includes('espn') || lowerName.includes('liga') || lowerName.includes('futbol') || lowerName.includes('football') || lowerName.includes('sport')) {
    extraGenres.push('Deportes');
  }
  if (lowerName.includes('movistar')) {
    extraGenres.push('Movistar');
  }
  return extraGenres;
}

function sanitizeId(id) {
  if (!id || typeof id !== 'string') return null;
  // keep only lowercase alnum and underscore
  let s = id.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  // trim leading/trailing underscores
  s = s.replace(/^_+|_+$/g, '');
  if (!s) return null;
  return s;
}

async function loadM3U({ m3uUrl = DEFAULT_M3U_URL } = {}) {
  if (!m3uUrl) {
    m3uUrl = DEFAULT_M3U_URL;
    console.log('m3uUrl was falsy, using DEFAULT_M3U_URL:', m3uUrl);
  }
  console.log('Loading M3U from:', m3uUrl);
  const hash = crypto.createHash('md5').update(m3uUrl).digest('hex');
  let channels = channelsCache.get(hash);
  if (channels) {
    console.log('Using cached channels for hash:', hash, 'count:', channels.length);
    return channels;
  }
  try {
    const controller = new AbortController();
    // 15s timeout for remote lists (some are slow)
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(m3uUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}, statusText: ${res.statusText}`);
    }
    const content = await res.text();
    console.log('M3U content downloaded, length:', content.length);

    const playlist = parse(content);
    const itemsCount = (playlist && playlist.items && playlist.items.length) || 0;
    console.log('M3U parsed, items:', itemsCount);

    if (!playlist.items || playlist.items.length === 0) {
      throw new Error('M3U playlist is empty or invalid');
    }

    const channelMap = {};

    playlist.items.forEach((item, index) => {
      // defensiva: item.tvg puede ser undefined
      const tvg = item.tvg || {};
      const rawName = (item.name || '').trim();

      // Prefer tvg.id si existe, si no genera a partir del nombre
      let candidateId = tvg.id || rawName || `channel_${index}`;
      candidateId = sanitizeId(candidateId) || `channel_${index}`;

      const tvgId = candidateId;

      const itemUrl = (item.url || '').trim();

      const isAce = itemUrl.startsWith('acestream://');
      const isM3u8 = itemUrl.endsWith('.m3u8') || itemUrl.includes('.m3u8?');

      const streamType = isAce ? 'Acestream' : isM3u8 ? 'M3U8' : 'Browser';

      let name = rawName;
      if (!name && item.raw) {
        const match = item.raw.match(/,([^,]+)/);
        name = match ? match[1].trim() : `Canal ${index + 1}`;
      }

      let groupTitle = tvg.group || '';
      if (!groupTitle && item.raw) {
        const groupMatch = item.raw.match(/group-title="([^"]+)"/i);
        groupTitle = groupMatch ? groupMatch[1] : 'Sin grupo';
      }

      const stream = {
        title: `${name} (${streamType})`,
        group_title: groupTitle,
        url: isM3u8 ? itemUrl : null,
        acestream_id: isAce ? itemUrl.replace('acestream://', '') : null,
        stream_url: (!isAce && !isM3u8) ? itemUrl : null
      };

      const logo = tvg.logo || '';

      console.log(`Processing stream: tvg-id=${tvgId}, name=${name}, group_title=${groupTitle}, url=${itemUrl}`);

      if (!channelMap[tvgId]) {
        channelMap[tvgId] = {
          id: tvgId,
          name: name || `Canal ${index + 1}`,
          logo_url: logo,
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
        // si ya no tiene m3u8_url y este stream tiene, rellenar
        if (!channelMap[tvgId].m3u8_url && stream.url) channelMap[tvgId].m3u8_url = stream.url;
        if (!channelMap[tvgId].acestream_id && stream.acestream_id) channelMap[tvgId].acestream_id = stream.acestream_id;
      }
    });

    channels = Object.values(channelMap);
    console.log(`Loaded ${channels.length} channels from M3U`);
    channelsCache.set(hash, channels);
    return channels;
  } catch (err) {
    console.error('Error loading M3U:', err.message);
    throw err;
  }
}

async function getChannels({ m3uUrl } = {}) {
  return await loadM3U({ m3uUrl });
}

async function getChannel(id, { m3uUrl } = {}) {
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
