// src/db.js
'use strict';

const fetch = require('node-fetch');
const { parse } = require('iptv-playlist-parser');

let cachedChannels = [];
const DEFAULT_M3U_URL = 'https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u';

function getExtraGenres(name) {
  const lowerName = String(name || '').toLowerCase();
  const extraGenres = [];
  if (
    lowerName.includes('deporte') ||
    lowerName.includes('formula 1') ||
    lowerName.includes('bein') ||
    lowerName.includes('f1') ||
    lowerName.includes('dazn') ||
    lowerName.includes('nba') ||
    lowerName.includes('espn') ||
    lowerName.includes('liga') ||
    lowerName.includes('futbol') ||
    lowerName.includes('football') ||
    lowerName.includes('sport')
  ) {
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
  if (extraGenres.length === 0) {
    extraGenres.push('General');
  }
  return extraGenres;
}

async function loadM3U(args = {}) {
  const m3uUrl = args.m3uUrl || DEFAULT_M3U_URL;
  console.log(`[loadM3U] Cargando lista M3U desde: ${m3uUrl}`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let content;
    try {
      console.log(`[loadM3U] Enviando solicitud HTTP a: ${m3uUrl}`);
      const res = await fetch(m3uUrl, { signal: controller.signal });
      console.log(`[loadM3U] Respuesta HTTP: status=${res.status}, statusText=${res.statusText}`);
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}, statusText: ${res.statusText}`);
      }
      content = await res.text();
      console.log(`[loadM3U] Contenido M3U descargado, longitud: ${content.length}, primeros 100 caracteres: ${content.slice(0, 100)}`);
    } finally {
      clearTimeout(timeoutId);
    }

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
    const channelSeenUrls = {}; // Evitar duplicados por canal
    const webPageExtensions = /\.(html|htm|php|asp|aspx|jsp)$/i;

    playlist.items.forEach((item, index) => {
      const rawUrl = String(item.url || '').trim();
      const nameFromId = item.name ? item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') : '';
      const tvgId = item.tvg.id || nameFromId || `channel_${index}`;

      const isAce = rawUrl.startsWith('acestream://');
      const isM3u8 = rawUrl.toLowerCase().includes('.m3u8'); // más robusto que endsWith
      const isWebPage = webPageExtensions.test(rawUrl);

      let streamType;
      let behaviorHints = {};
      if (isAce) {
        streamType = 'Acestream';
        behaviorHints = { notWebReady: true, external: true };
      } else if (isM3u8) {
        streamType = 'M3U8';
        behaviorHints = { notWebReady: false, external: false };
      } else if (isWebPage) {
        streamType = 'Browser';
        behaviorHints = { notWebReady: true, external: true };
      } else {
        streamType = 'Directo';
        behaviorHints = { notWebReady: false, external: false };
      }

      let name = item.name || '';
      if (!name && item.raw) {
        const match = item.raw.match(/,([^,]+)/);
        name = match ? match[1].trim() : `Canal ${index + 1}`;
      }

      let groupTitle = item.tvg.group || '';
      if (!groupTitle && item.raw) {
        const groupMatch = item.raw.match(/group-title="([^"]+)"/);
        groupTitle = groupMatch ? groupMatch[1] : 'General';
      }
      if (!groupTitle) groupTitle = 'General';

      // Clave única para detectar duplicados dentro del canal
      const urlKey = isAce ? `acestream://${rawUrl.replace('acestream://', '')}` : rawUrl;

      const stream = {
        title: `${name} (${streamType})`,
        group_title: groupTitle,
        url: isM3u8 ? rawUrl : null,
        acestream_id: isAce ? rawUrl.replace('acestream://', '') : null,
        stream_url: (!isAce && !isM3u8 && !isWebPage) ? rawUrl : (isWebPage ? null : rawUrl), // mantiene valor si no es ace/m3u8; webpage no va en stream_url
        behaviorHints
      };

      const extraGenres = getExtraGenres(name);

      if (!channelMap[tvgId]) {
        channelMap[tvgId] = {
          id: tvgId,
          name: name || `Canal ${index + 1}`,
          logo_url: item.tvg.logo || '',
          group_title: groupTitle,
          acestream_id: stream.acestream_id || null,
          m3u8_url: stream.url || null,
          stream_url: (!isAce && !isM3u8 && !isWebPage) ? rawUrl : null,
          website_url: isWebPage ? rawUrl : null,
          title: stream.title,
          additional_streams: [],
          extra_genres: extraGenres
        };
        channelSeenUrls[tvgId] = new Set();
      } else {
        // Completar website_url si aún no está y el item actual es webpage
        if (!channelMap[tvgId].website_url && isWebPage) {
          channelMap[tvgId].website_url = rawUrl;
        }
        // Completar principales si aún no están
        if (!channelMap[tvgId].acestream_id && stream.acestream_id) channelMap[tvgId].acestream_id = stream.acestream_id;
        if (!channelMap[tvgId].m3u8_url && stream.url) channelMap[tvgId].m3u8_url = stream.url;
        if (!channelMap[tvgId].stream_url && (!isAce && !isM3u8 && !isWebPage)) channelMap[tvgId].stream_url = rawUrl;
      }

      // Evitar duplicados exactos por URL en additional_streams
      if (urlKey && !channelSeenUrls[tvgId].has(urlKey)) {
        channelMap[tvgId].additional_streams.push(stream);
        channelSeenUrls[tvgId].add(urlKey);
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
