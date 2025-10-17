// src/db.js
'use strict';

const fetch = require('node-fetch');
const { parse } = require('iptv-playlist-parser');

let cachedChannels = [];
const DEFAULT_M3U_URL = 'https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u';

function getExtraGenres(canal) {
  const name = (canal.name || '').toLowerCase();
  const id = (canal.id || '').toLowerCase();
  const genres = new Set();

  // País por sufijo
  if (id.endsWith('.es')) genres.add('España');
  if (id.endsWith('.ar')) genres.add('Argentina');
  if (id.endsWith('.pt')) genres.add('Portugal');

  // Movistar
  if (id.includes('movistar')) genres.add('Movistar');

  // Cine & Series
  const cineSeriesIds = new Set([
    'hollywood.es', 'movistar.estrenos.es', 'movistar.hits.es', 'movistar.comedia.es',
    'movistar.accion.es', 'movistar.drama.es', 'movistar.especial.1.es', 'movistar.especial.2.es',
    'movistar.indie.es', 'movistar.clasicos.es', 'movistar.cine.espanol.es',
    'movistar.documentales.es', 'movistar.originales.es', 'invitado.es', 'dark.es',
    'axn.es', 'axn.movie.es', 'amc.es', 'calle.13.es'
  ]);
  if (cineSeriesIds.has(id)) genres.add('Cine & Series');

  // Documentales
  const documentalesIds = new Set([
    'movistar.documentales.es', 'movistar.originales.es', 'crime.es', 'odisea.es',
    'movistar.plus.es', 'movistar.plus.2.es', 'national.geographic.wild.es'
  ]);
  if (documentalesIds.has(id)) genres.add('Documentales');

  // Liga de Campeones
  if (id.includes('liga.de.campeones')) genres.add('Liga de Campeones');

  // La Liga
  if (id.includes('laliga') || id.includes('la.liga')) genres.add('La Liga');
  if (id === 'movistar.plus.es' || id === 'movistar.plus.2.es') genres.add('La Liga');

  // Deportes
  const deportesKeywords = [
    'vamos', 'deporte', 'formula 1', 'bein', 'f1', 'dazn', 'nba', 'espn',
    'liga', 'futbol', 'football', '1rfef', 'copa', 'gol', 'sport', 'golf'
  ];
  if (deportesKeywords.some(k => id.includes(k) || name.includes(k))) genres.add('Deportes');

  // DAZN
  if (id.includes('dazn')) genres.add('DAZN');

  // ESPN
  if (id.includes('espn')) genres.add('ESPN');

  // Fútbol
  const futbolTriggers = ['futbol', 'football', '1rfef', 'copa', 'gol'];
  const hasFutbolKeyword = futbolTriggers.some(k => id.includes(k));
  const hasFutbolGenero = ['La Liga', 'Liga de Campeones', 'ESPN'].some(g => genres.has(g));
  if (hasFutbolKeyword || hasFutbolGenero) genres.add('Fútbol');

  if (genres.size === 0) genres.add('General');

  return Array.from(genres);
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
    const channelSeenUrls = {};
    const webPageExtensions = /\.(html|htm|php|asp|aspx|jsp)$/i;

    playlist.items.forEach((item, index) => {
      const rawUrl = String(item.url || '').trim();
      const nameFromId = item.name ? item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') : '';
      const tvgId = item.tvg.id || nameFromId || `channel_${index}`;

      const isAce = rawUrl.startsWith('acestream://');
      const isM3u8 = rawUrl.toLowerCase().includes('.m3u8');
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

      // Clave de deduplicación por URL dentro del canal
      const urlKey = isAce ? `acestream://${rawUrl.replace('acestream://', '')}` : rawUrl;

      const stream = {
        title: `${name} (${streamType})`,
        group_title: groupTitle || 'General',
        url: isM3u8 ? rawUrl : null,
        acestream_id: isAce ? rawUrl.replace('acestream://', '') : null,
        stream_url: (!isAce && !isM3u8 && !isWebPage) ? rawUrl : null,
        behaviorHints
      };

      const extraGenres = getExtraGenres({ id: tvgId, name });

      if (!channelMap[tvgId]) {
        // Crear canal principal (no se sobrescriben estos metadatos después)
        channelMap[tvgId] = {
          id: tvgId,
          name: name || `Canal ${index + 1}`,
          logo_url: item.tvg.logo || '',
          group_title: groupTitle,
          acestream_id: stream.acestream_id || null,
          // NUEVO: conservar el grupo del primer Ace que se promociona
          acestream_group_title: stream.acestream_id ? stream.group_title : null,
          m3u8_url: stream.url || null,
          stream_url: (!isAce && !isM3u8 && !isWebPage) ? rawUrl : null,
          website_url: isWebPage ? rawUrl : null,
          title: stream.title,
          additional_streams: [],
          extra_genres: extraGenres
        };
        channelSeenUrls[tvgId] = new Set();
      } else {
        // Completar metadatos sin sobrescribir los principales
        if (!channelMap[tvgId].website_url && isWebPage) {
          channelMap[tvgId].website_url = rawUrl;
        }
        if (!channelMap[tvgId].acestream_id && stream.acestream_id) {
          channelMap[tvgId].acestream_id = stream.acestream_id;
          // NUEVO: guardar el group_title del Ace principal
          channelMap[tvgId].acestream_group_title = stream.group_title || channelMap[tvgId].acestream_group_title || null;
        }
        if ((!channelMap[tvgId].acestream_id && !channelMap[tvgId].stream_url) && stream.url) {
          channelMap[tvgId].m3u8_url = stream.url;
        }
        if (!channelMap[tvgId].stream_url && (!isAce && !isM3u8 && !isWebPage)) {
          channelMap[tvgId].stream_url = rawUrl;
        }
      }

      // Añadir stream adicional evitando duplicados por URL
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
  //cachedChannels.forEach(item => {
  //  console.log('[DEBUG] Canal disponible:', item.id);
  //});
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
  if (channel.acestream_id) {
    console.log('[AUDIT][DB] Canal con Ace detectado:', {
      id: channel.id,
      name: channel.name,
      group_title: channel.group_title,
      acestream_id: channel.acestream_id,
      // NUEVO: auditar también el grupo del Ace principal
      acestream_group_title: channel.acestream_group_title || null
    });
  }
  return channel;
}

module.exports = {
  getChannels,
  getChannel,
  loadM3U
};
