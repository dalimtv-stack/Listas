// api/handlers/stream.js
'use strict';

const NodeCache = require('node-cache');
const { getChannel } = require('../../src/db');
const { scrapeExtraWebs } = require('../scraper');
const { kvGet, kvSet, kvGetJsonTTL, kvSetJsonTTLIfChanged, kvDelete } = require('../kv');
const { expandirAcestreamConFormatos, detectarFormatoDesdeUrl, normalizeCatalogName, getM3uHash, extractConfigIdFromUrl } = require('../utils');
const { CACHE_TTL } = require('../../src/config');
const { resolveM3uUrl, resolveExtraWebs } = require('../resolve');

// --- Import de eventos ---
const { getStreams: getEventosStreams } = require('../../src/eventos/stream-events');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

function extraerYLimpiarCalidad(label = '') {
  const logPrefix = '[STREAM][CALIDAD]';
  console.log(logPrefix, `Procesando calidad raw: "${label}"`);
  const calidadRaw = label.toLowerCase();
  const map = [
    { match: ['4320p', '4320'], nombre: 'Full UHD (4320p)' },
    { match: ['2160p', '2160', 'uhd', '4k'], nombre: 'Ultra HD - 4K (2160p)' },
    { match: ['1440p', '1440', '2k', 'qhd', 'quad hd'], nombre: 'Quad HD - 2K (1440p)' },
    { match: ['1080p', '1080', 'fhd'], nombre: 'Full HD (1080p)' },
    { match: ['720p', '720', 'hd'], nombre: 'HD (720p)' },
    { match: ['540p', '540', '480p', '480', 'sd'], nombre: 'SD (480p/540p)' }
  ];
  let calidadDetectada = 'Sin especificar';
  for (const { match, nombre } of map) {
    if (match.some(m => calidadRaw.includes(m))) {
      calidadDetectada = nombre;
      console.log(logPrefix, `Calidad detectada: "${calidadDetectada}" para raw: "${label}"`);
      break;
    }
  }
  if (calidadDetectada === 'Sin especificar') {
    console.log(logPrefix, `No se detectó calidad para: "${label}", asignando "Sin especificar"`);
  }
  return calidadDetectada;
}

async function handleStream(req) {
  const logPrefix = '[STREAM]';
  const id = String(req.params.id).replace(/\.json$/, '');
  const configId = req.params.configId || extractConfigIdFromUrl(req);

  // --- Rama de eventos ---
  if (id.startsWith('Heimdallr_evt')) {
    const { streams, chName } = await getEventosStreams(id, configId);
    console.log(logPrefix, `streams de evento generados: ${streams.length}`);
    // asegurar que el id está presente para enriquecido posterior
    return { streams, chName, id };
  }

  const m3uUrl = await resolveM3uUrl(configId);
  console.log('[ROUTE] STREAM', { url: req.originalUrl, id, configId, m3uUrl: m3uUrl ? '[ok]' : null });

  if (!m3uUrl) {
    console.log(logPrefix, 'm3uUrl no resuelta');
    return { streams: [], chName: '', id };
  }

  const currentM3uHash = await getM3uHash(m3uUrl);
  const storedM3uHashKey = `m3u_hash:${configId}`;
  const storedM3uHash = await kvGet(storedM3uHashKey);

  let forceScrape = false;
  if (!storedM3uHash || storedM3uHash !== currentM3uHash) {
    console.log(logPrefix, `M3U hash cambiado, invalidando caché de streams para ${configId}`);
    await kvSet(storedM3uHashKey, currentM3uHash);
    forceScrape = true;
    const streamKvKey = `stream:${currentM3uHash}:${id}`;
    await kvDelete(streamKvKey);
    console.log(logPrefix, `Caché de streams limpiado: ${streamKvKey}`);
    await kvDelete(`scrape:${id.split('_').slice(2).join('_').toLowerCase()}`);
    console.log(logPrefix, `Caché de scraper limpiado para ${id}`);
  }

  const m3uHash = currentM3uHash;
  const kvKey = `stream:${m3uHash}:${id}`;
  let kvCached = await kvGetJsonTTL(kvKey);

  if (kvCached && !forceScrape) {
    console.log(logPrefix, 'Usando caché KV:', kvCached);
    // adjuntar id para enriquecido (país)
    kvCached.id = id;
    const enriched = await enrichWithExtra(kvCached, configId, m3uUrl, forceScrape);
    return enriched;
  }

  let result = await handleStreamInternal({ id, m3uUrl, configId });
  // adjuntar id para enriquecido (país)
  result.id = id;
  const enriched = await enrichWithExtra(result, configId, m3uUrl, forceScrape);

  await kvSetJsonTTLIfChanged(kvKey, enriched, 3600);

  console.log(logPrefix, 'Respuesta final con streams:', enriched.streams);
  return enriched;
}

async function handleStreamInternal({ id, m3uUrl, configId }) {
  const logPrefix = '[STREAM]';
  const parts = id.split('_');
  const channelId = parts.slice(2).join('_');

  const ch = await getChannel(channelId, { m3uUrl });
  console.log(logPrefix, `[AUDIT] Datos obtenidos de getChannel para ${channelId}:`, {
    name: ch?.name,
    calidad: ch?.calidad,
    acestream_id: ch?.acestream_id,
    m3u8_url: ch?.m3u8_url,
    stream_url: ch?.stream_url,
    url: ch?.url,
    website_url: ch?.website_url,
    additional_streams: ch?.additional_streams?.map(s => ({
      name: s.name,
      calidad: s.calidad,
      acestream_id: s.acestream_id,
      m3u8_url: s.m3u8_url,
      stream_url: s.stream_url,
      url: s.url,
      group_title: s.group_title
    }))
  });

  if (!ch) {
    console.log(logPrefix, `canal no encontrado: ${channelId}`);
    return { streams: [], chName: '' };
  }

  const chName = ch.name;
  const streams = [];
  const seenUrls = new Set();

  const addStream = (src) => {
    const streamUrl = src.acestream_id ? `acestream://${src.acestream_id}` : src.m3u8_url || src.stream_url || src.url;

    if (!streamUrl || seenUrls.has(streamUrl)) {
      console.log(logPrefix, `Descartado stream duplicado o sin URL: ${streamUrl}`);
      return;
    }

    let behaviorHints;
    if (src.acestream_id) {
      behaviorHints = { notWebReady: true, external: true };
    } else {
      behaviorHints = src.behaviorHints || { notWebReady: false, external: false };
    }

    // Fix: si es el canal principal con Ace, usar su acestream_group_title para etiquetar correctamente
    let name;
    let title;
    let group_title_for_audit;

    if (src.acestream_id && src.id === ch.id) {
      const aceGroup = src.acestream_group_title || src.group_title || 'Acestream';
      name = aceGroup;
      title = `${chName} (Acestream)`;
      group_title_for_audit = aceGroup;
    } else {
      const grp = src.group_title || 'Stream';
      name = src.group_title || src.name || chName;
      title = src.title || `${chName} (${grp})`;
      group_title_for_audit = src.group_title;
    }

    const out = {
      name,
      title,
      calidad: src.calidad, // Mantener calidad original para auditoría
      behaviorHints,
      // solo para auditoría/depuración; Stremio lo ignora
      group_title: group_title_for_audit
    };

    if (src.acestream_id) {
      out.externalUrl = streamUrl;
    } else {
      out.url = streamUrl;
    }

    seenUrls.add(streamUrl);
    streams.push(out);
    console.log(logPrefix, `[AUDIT] Añadido stream:`, {
      streamUrl,
      name,
      title,
      calidad: src.calidad,
      group_title: group_title_for_audit,
      behaviorHints
    });
  };

  // Añadir posibles principales: Ace/M3U8/Directo/url
  if (ch.acestream_id || ch.m3u8_url || ch.stream_url || ch.url) {
    addStream(ch);
  }

  // Añadir adicionales
  if (Array.isArray(ch.additional_streams)) {
    ch.additional_streams.forEach(addStream);
  }

  // Añadir website si existe
  if (ch.website_url && !seenUrls.has(ch.website_url)) {
    streams.push({
      title: `${ch.name} - Website`,
      externalUrl: ch.website_url,
      behaviorHints: { notWebReady: true, external: true },
      group_title: 'Website'
    });
    seenUrls.add(ch.website_url);
    console.log(logPrefix, `Añadido website_url: ${ch.website_url}`);
  }

  const resp = { streams, chName };
  console.log(logPrefix, `streams para ${channelId}: ${streams.length}`);
  console.log(logPrefix, `[AUDIT] Streams construidos en handleStreamInternal:`, streams);
  return resp;
}

async function enrichWithExtra(baseObj, configId, m3uUrl, forceScrape = false) {
  const logPrefix = '[STREAM]';
  const chName = baseObj.chName || baseObj.id?.split('_').slice(2).join(' ') || '';
  const extraWebsList = await resolveExtraWebs(configId);
  if (extraWebsList.length) {
    try {
      console.log(logPrefix, `Llamando scrapeExtraWebs con forceScrape=${forceScrape} para ${chName}`);
      const extraStreams = await scrapeExtraWebs(chName, extraWebsList, forceScrape);
      console.log(logPrefix, `[AUDIT] Streams extra devueltos por scraper:`, extraStreams);
      if (extraStreams.length > 0) {
        // Deduplicación: por URL o AceID
        const existingKeys = new Set(
          baseObj.streams.map(s => {
            if (s.externalUrl && s.externalUrl.startsWith('acestream://')) {
              return 'ace:' + s.externalUrl.replace('acestream://', '');
            }
            return 'url:' + (s.url || s.externalUrl);
          })
        );

        const nuevos = extraStreams.filter(s => {
          let key;
          if (s.externalUrl && s.externalUrl.startsWith('acestream://')) {
            key = 'ace:' + s.externalUrl.replace('acestream://', '');
          } else {
            key = 'url:' + (s.url || s.externalUrl);
          }
          return key && !existingKeys.has(key);
        });

        if (nuevos.length) {
          baseObj.streams = [...nuevos, ...baseObj.streams];
          console.log(logPrefix, `Añadidos ${nuevos.length} streams extra para ${chName}`);
        } else {
          console.log(logPrefix, `No se añadieron streams extra para ${chName} (sin coincidencias)`);
        }
      } else {
        console.log(logPrefix, `No se añadieron streams extra para ${chName} (sin coincidencias)`);
      }
    } catch (e) {
      console.error(logPrefix, `Error en scrapeExtraWebs para ${chName}:`, e.message);
    }
  }

  // --- Enriquecer títulos justo antes de devolver ---
  baseObj.streams = baseObj.streams.map(s => {
    // Mantener originalTitle para multiaudio
    const originalTitle = s.title || '';
    const calidadDetectada = s.calidad ? extraerYLimpiarCalidad(s.calidad) : 'Sin especificar';
    console.log(logPrefix, `[AUDIT] Procesando título para stream:`, {
      originalTitle,
      calidadRaw: s.calidad,
      calidadDetectada,
      name: s.name,
      group_title: s.group_title
    });

    const proveedor = (s.group_title || s.name || '').trim();
    const canal = normalizeCatalogName((baseObj.chName || '')).trim();
    const urlReal = s.url || s.externalUrl || s.link || ''; 
    const formato = detectarFormatoDesdeUrl(urlReal, s.behaviorHints || {});

    // --- Audio: Multiaudio si estaba en el título original; si no, país por sufijo del id del canal ---
    let audioInfo = '';
    if (/multiaudio/i.test(originalTitle)) {
      audioInfo = 'Multiaudio';
    } else {
      const ref = String(baseObj.id || '').toLowerCase().trim();
      // ejemplos: ..._Hollywood.es.json | ..._TyC.ar.json
      if (ref.endsWith('.es.json') || ref.endsWith('.es')) {
        audioInfo = 'España';
      } else if (ref.endsWith('.ar.json') || ref.endsWith('.ar')) {
        audioInfo = 'Argentina';
      } else if (ref.endsWith('.us.json') || ref.endsWith('.us')) {
        audioInfo = 'USA';
      } else if (ref.endsWith('.apt.json') || ref.endsWith('.pt')) {
        audioInfo = 'Portugal';
      }
    }

    const newTitle =
      `Formato:  ${formato}\n` +
      `Calidad: 🖥️ ${calidadDetectada}` +
      (audioInfo ? `\nAudio: 🎧 ${audioInfo}` : '') + '\n' +
      `Canal: 📡 ${canal}\n` +
      `Proveedor: 🏴‍☠️${proveedor}🏴‍☠️`;

    console.log(logPrefix, `[AUDIT] Título final para stream:`, {
      newTitle,
      formato,
      calidadDetectada,
      audioInfo,
      canal,
      proveedor
    });

    return {
      ...s,
      title: newTitle
    };
  });
  
  // --- Expandir Acestreams con variantes VLC y Directo (Acestream) ---
  baseObj.streams = expandirAcestreamConFormatos(baseObj.streams);
  
  // --- Ordenar streams por formato y calidad ---
  const formatoOrden = {
    'M3U8Directo': 1,
    'DirectoAce': 2,
    'Acestream': 3,
    'VLC': 4,
    'Otros': 5
  };

  const calidadOrden = {
    'Ultra HD - 4K (2160p)': 1,
    'Quad HD - 2K (1440p)': 2,
    'Full HD (1080p)': 3,
    'HD (720p)': 4,
    'SD (480p/540p)': 5,
    'Sin especificar': 6
  };

  baseObj.streams.sort((a, b) => {
    const formatoA = normalizarFormatoParaOrden(a.title);
    const formatoB = normalizarFormatoParaOrden(b.title);

    const calidadA = Object.keys(calidadOrden).find(c => a.title.includes(c)) || 'Sin especificar';
    const calidadB = Object.keys(calidadOrden).find(c => b.title.includes(c)) || 'Sin especificar';

    console.log(logPrefix, `[AUDIT] Ordenando streams:`, {
      streamA: { title: a.title, formato: formatoA, calidad: calidadA },
      streamB: { title: b.title, formato: formatoB, calidad: calidadB }
    });

    if (formatoOrden[formatoA] !== formatoOrden[formatoB]) {
      return formatoOrden[formatoA] - formatoOrden[formatoB];
    }
    return calidadOrden[calidadA] - calidadOrden[calidadB];
  });

  console.log(logPrefix, `[AUDIT] Streams finales tras enrichWithExtra:`, baseObj.streams);
  return baseObj;
}

function normalizarFormatoParaOrden(titulo = '') {
  if (titulo.includes('Directo (Acestream)')) return 'DirectoAce';
  if (titulo.includes('Acestream')) return 'Acestream';
  if (titulo.includes('VLC')) return 'VLC';
  if (titulo.includes('M3U8') || titulo.includes('Directo')) return 'M3U8Directo';
  return 'Otros';
}

module.exports = { handleStream, handleStreamInternal, enrichWithExtra };
