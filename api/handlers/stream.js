'use strict';

const NodeCache = require('node-cache');
const { getChannel } = require('../../src/db');
const { scrapeExtraWebs } = require('../scraper');
const { kvGet, kvSet, kvGetJsonTTL, kvSetJsonTTLIfChanged, kvDelete } = require('../kv');
const { getM3uHash, extractConfigIdFromUrl } = require('../utils');
const { CACHE_TTL } = require('../../src/config');
const { resolveM3uUrl, resolveExtraWebs } = require('../resolve');
const { getStreams: getEventosStreams } = require('../../src/eventos/stream-events');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

function extraerYLimpiarCalidad(label = '') {
  const calidadRaw = label.toLowerCase();
  const map = [
    { match: ['4320p', '4320'], nombre: 'Full UHD (4320p)' },
    { match: ['2160p', '2160', 'uhd', '4k'], nombre: 'Ultra HD - 4K(2160p)' },
    { match: ['1440p', '1440', '2k', 'qhd', 'quad hd'], nombre: 'Quad HD - 2K(1440p)' },
    { match: ['1080p', '1080', 'fhd'], nombre: 'Full HD (1080p)' },
    { match: ['720p', '720', 'hd'], nombre: 'HD (720p)' },
    { match: ['540p', '540', '480p', '480', 'sd'], nombre: 'SD (480p/540p)' }
  ];

  let calidadDetectada = 'Sin especificar';
  for (const { match, nombre } of map) {
    if (match.some(m => calidadRaw.includes(m))) {
      calidadDetectada = nombre;
      break;
    }
  }

  return calidadDetectada;
}

async function handleStream(req) {
  const logPrefix = '[STREAM]';
  const id = String(req.params.id).replace(/\.json$/, '');
  const configId = req.params.configId || extractConfigIdFromUrl(req);

  if (id.startsWith('Heimdallr_evt')) {
    const { streams, chName } = await getEventosStreams(id, configId);
    console.log(logPrefix, `streams de evento generados: ${streams.length}`);
    return { streams, chName };
  }

  const m3uUrl = await resolveM3uUrl(configId);
  console.log('[ROUTE] STREAM', { url: req.originalUrl, id, configId, m3uUrl: m3uUrl ? '[ok]' : null });

  if (!m3uUrl) {
    console.log(logPrefix, 'm3uUrl no resuelta');
    return { streams: [], chName: '' };
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
  console.log(logPrefix, `KV key usada para cache de streams: ${kvKey}`);
  let kvCached = await kvGetJsonTTL(kvKey);

  if (kvCached && !forceScrape) {
    console.log(logPrefix, 'Usando caché KV:', kvCached);
    const enriched = await enrichWithExtra(kvCached, configId, m3uUrl, forceScrape);
    return enriched;
  }

  let result = await handleStreamInternal({ id, m3uUrl, configId });
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
  if (!ch) {
    console.log(logPrefix, `canal no encontrado: ${channelId}`);
    return { streams: [], chName: '' };
  }

  const chName = ch.name;
  const streams = [];
  const seenUrls = new Set();

	const addStream = (src) => {
	  const streamUrl = src.acestream_id
		? `acestream://${src.acestream_id}`
		: src.m3u8_url || src.stream_url || src.url;

	  if (!streamUrl || seenUrls.has(streamUrl)) return;

	  const behaviorHints = src.acestream_id
		? { notWebReady: true, external: true }
		: src.behaviorHints || { notWebReady: false, external: false };

	  const originalTitle = src.title || ''; // usar el title original
	  const calidadDetectada = extraerYLimpiarCalidad(originalTitle);
	  const formato = src.acestream_id
		? 'Acestream'
		: streamUrl.includes('m3u8')
		? 'M3U8'
		: streamUrl.includes('vlc')
		? 'VLC'
		: 'Directo';

	  const out = {
		...src, // mantiene name, group_title, etc. sin tocarlos
		title: `Formato: 🔗 ${formato}\nCalidad: 🖥️ ${calidadDetectada}\nCanal: 📡 ${ch.name}\nProveedor: 🏴‍☠️${src.name}🏴‍☠️`,
		behaviorHints
	  };

	  if (src.acestream_id) {
		out.externalUrl = streamUrl;
	  } else {
		out.url = streamUrl;
	  }

	  seenUrls.add(streamUrl);
	  streams.push(out);
	};

  if (ch.acestream_id || ch.m3u8_url || ch.stream_url || ch.url) {
    addStream(ch);
  }

  if (Array.isArray(ch.additional_streams)) {
    ch.additional_streams.forEach(addStream);
  }

  if (ch.website_url && !seenUrls.has(ch.website_url)) {
    const proveedor = 'Website';
    streams.push({
      name: proveedor,
      title: `Formato: 🔗 Website\nCalidad: 🖥️ Sin especificar\nCanal: 📡 ${ch.name}\nProveedor: 🏴‍☠️${proveedor}🏴‍☠️`,
      externalUrl: ch.website_url,
      behaviorHints: { notWebReady: true, external: true },
      group_title: proveedor
    });
    seenUrls.add(ch.website_url);
  }

  return { streams, chName };
}

async function enrichWithExtra(baseObj, configId, m3uUrl, forceScrape = false) {
  const logPrefix = '[STREAM]';
  const chName = baseObj.chName || baseObj.id?.split('_').slice(2).join(' ') || '';
  const extraWebsList = await resolveExtraWebs(configId);
  if (extraWebsList.length) {
    try {
      const extraStreams = await scrapeExtraWebs(chName, extraWebsList, forceScrape);
      if (extraStreams.length > 0) {
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

        nuevos.forEach(s => {
          const proveedor = s.name || '';
          const originalTitle = s.title || '';
          const calidadDetectada = extraerYLimpiarCalidad(originalTitle);
        
          const formato = s.externalUrl?.startsWith('acestream://')
            ? 'Acestream'
            : s.url?.includes('m3u8')
            ? 'M3U8'
            : s.url?.includes('vlc')
            ? 'VLC'
            : 'Directo';
        
          s.title = `Formato: 🔗 ${formato}\nCalidad: 🖥️ ${calidadDetectada}\nCanal: 📡 ${chName}\nProveedor: 🏴‍☠️${proveedor}🏴‍☠️`;
        });

        baseObj.streams = [...nuevos, ...baseObj.streams];
        console.log(logPrefix, `Añadidos ${nuevos.length} streams extra para ${chName}`);
      } else {
        console.log(logPrefix, `No se añadieron streams extra para ${chName} (sin coincidencias)`);
      }
    } catch (e) {
      console.error(logPrefix, `Error en scrapeExtraWebs para ${chName}:`, e.message);
    }
  }

  console.log(logPrefix, 'Respuesta final con streams:', baseObj.streams);
  return baseObj;
}

module.exports = { handleStream, handleStreamInternal, enrichWithExtra };
