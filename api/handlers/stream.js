//api/handlers/stream.js
'use strict';

const NodeCache = require('node-cache');
const { getChannel } = require('../../src/db');
const { scrapeExtraWebs } = require('../scraper');
const { kvGet, kvSet, kvGetJsonTTL, kvSetJsonTTL, kvDelete } = require('../kv');
const { getM3uHash, extractConfigIdFromUrl } = require('../utils');
const { CACHE_TTL } = require('../../src/config');
const { resolveM3uUrl, resolveExtraWebs } = require('../resolve');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

async function handleStream(req) {
  const logPrefix = '[STREAM]';
  const id = String(req.params.id).replace(/\.json$/, '');
  const configId = req.params.configId || extractConfigIdFromUrl(req);
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
    await kvDelete(`scrape:${id.split('_').slice(2).join('_').toLowerCase()}`); // Limpiar caché de scraper
    console.log(logPrefix, `Caché de scraper limpiado para ${id}`);
  }

  const m3uHash = currentM3uHash;
  const kvKey = `stream:${m3uHash}:${id}`;
  let kvCached = await kvGetJsonTTL(kvKey);

  if (kvCached && !forceScrape) {
    console.log(logPrefix, 'Usando caché KV:', kvCached);
    const enriched = await enrichWithExtra(kvCached, configId, m3uUrl, forceScrape);
    return enriched;
  }

  let result = await handleStreamInternal({ id, m3uUrl, configId });
  const enriched = await enrichWithExtra(result, configId, m3uUrl, forceScrape);
  await kvSetJsonTTL(kvKey, enriched);
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
  const seenUrls = new Set(); // Para evitar duplicados

  const addStream = (src) => {
    const out = { name: src.group_title || src.name, title: src.title || src.name };
    let streamUrl = null;

    if (src.acestream_id) {
      streamUrl = `acestream://${src.acestream_id}`;
      out.externalUrl = streamUrl;
      out.behaviorHints = { notWebReady: true, external: true };
    } else if (src.m3u8_url || src.stream_url || src.url) {
      streamUrl = src.m3u8_url || src.stream_url || src.url;
      out.url = streamUrl;
      out.behaviorHints = { notWebReady: false, external: false };
    }
    if (src.group_title) out.group_title = src.group_title;

    // Solo añadir si la URL no está ya en la lista
    if (streamUrl && !seenUrls.has(streamUrl)) {
      seenUrls.add(streamUrl);
      streams.push(out);
      console.log(logPrefix, `Añadido stream: ${streamUrl}`);
    } else if (streamUrl) {
      console.log(logPrefix, `Descartado stream duplicado: ${streamUrl}`);
    }
  };

  // Añadir el stream principal del canal
  if (ch.acestream_id || ch.m3u8_url || ch.stream_url || ch.url) {
    addStream(ch);
  }

  // Añadir streams adicionales, evitando duplicados
  if (Array.isArray(ch.additional_streams)) {
    ch.additional_streams.forEach(addStream);
  }

  // Añadir website_url si existe
  if (ch.website_url && !seenUrls.has(ch.website_url)) {
    streams.push({
      title: `${ch.name} - Website`,
      externalUrl: ch.website_url,
      behaviorHints: { notWebReady: true, external: true }
    });
    seenUrls.add(ch.website_url);
    console.log(logPrefix, `Añadido website_url: ${ch.website_url}`);
  }

  const resp = { streams, chName };
  console.log(logPrefix, `streams para ${channelId}: ${streams.length}`);
  return resp;
}

async function enrichWithExtra(baseObj, configId, m3uUrl, forceScrape = false) {
  const logPrefix = '[STREAM]';
  const chName = baseObj.chName || baseObj.id.split('_').slice(2).join(' ');
  const extraWebsList = await resolveExtraWebs(configId);
  if (extraWebsList.length) {
    try {
      console.log(logPrefix, `Llamando scrapeExtraWebs con forceScrape=${forceScrape} para ${chName}`);
      const extraStreams = await scrapeExtraWebs(chName, extraWebsList, forceScrape);
      console.log(logPrefix, 'Streams extra devueltos por scraper:', extraStreams);
      if (extraStreams.length > 0) {
        const existingUrls = new Set(baseObj.streams.map(s => s.url || s.externalUrl));
        const nuevos = extraStreams.filter(s => {
          const url = s.url || s.externalUrl;
          return url && !existingUrls.has(url);
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
  console.log(logPrefix, 'Respuesta final con streams:', baseObj.streams);
  return baseObj;
}

module.exports = { handleStream, handleStreamInternal, enrichWithExtra };
