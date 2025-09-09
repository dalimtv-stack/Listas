// db.js
const fetch = require('node-fetch');
const { parse } = require('iptv-playlist-parser');
const NodeCache = require('node-cache');
const crypto = require('crypto');

const CACHE_TTL = 300; // 5 minutos
const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Función para cargar y parsear M3U desde URL
async function loadM3U(url) {
  if (!url) throw new Error('M3U URL is required');
  const hash = crypto.createHash('md5').update(url).digest('hex');
  const cacheKey = `m3u_${hash}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Failed to fetch M3U: ${res.status} ${res.statusText}`);
    const text = await res.text();
    const playlist = parse(text);
    cache.set(cacheKey, playlist.items);
    return playlist.items;
  } catch (err) {
    console.error('loadM3U error:', err.message);
    throw err;
  }
}

// Obtener todos los canales
async function getChannels({ m3uUrl }) {
  const items = await loadM3U(m3uUrl);
  return items.map(item => {
    const additional_streams = [];
    if (item.extra && item.extra.streams && Array.isArray(item.extra.streams)) {
      item.extra.streams.forEach(s => {
        additional_streams.push({
          title: s.title || item.name,
          group_title: s.group_title || item.group_title,
          url: s.url,
          acestream_id: s.acestream_id || null
        });
      });
    }
    const extra_genres = Array.isArray(item.extra?.genres) ? item.extra.genres : [];
    return {
      id: item.tvgId || item.name,
      name: item.name,
      logo_url: item.tvgLogo || item.logo || '',
      group_title: item.groupTitle || item.group_title || 'Unknown',
      title: item.name,
      m3u8_url: item.url?.endsWith('.m3u8') ? item.url : null,
      stream_url: item.url && !item.url.startsWith('acestream://') && !item.url.endsWith('.m3u8') ? item.url : null,
      acestream_id: item.url && item.url.startsWith('acestream://') ? item.url.replace('acestream://', '') : null,
      additional_streams,
      extra_genres,
      website_url: item.tvgUrl || item.website || ''
    };
  });
}

// Obtener un canal específico
async function getChannel(channelId, { m3uUrl }) {
  const channels = await getChannels({ m3uUrl });
  const channel = channels.find(c => c.id === channelId);
  if (!channel) throw new Error(`Channel not found: ${channelId}`);
  return channel;
}

module.exports = {
  loadM3U,
  getChannels,
  getChannel
};
