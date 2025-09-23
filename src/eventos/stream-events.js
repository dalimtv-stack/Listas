// src/eventos/stream-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJson } = require('../../api/kv'); // leer config desde KV

async function getStreams(id, configId) {
  try {
    const configData = await kvGetJson(configId);
    const url = configData?.eventosUrl;

    if (!url) {
      console.warn(`[EVENTOS] No se encontró eventosUrl en la configuración para configId=${configId}`);
      return { streams: [], chName: '' };
    }

    const eventos = await fetchEventos(url);
    const evento = eventos.find(ev => normalizeId(ev) === id);
    if (!evento) {
      console.warn(`[EVENTOS] Evento no encontrado para id=${id}`);
      return { streams: [], chName: '' };
    }

    const seen = new Set();
    const streams = [];

    for (const canal of evento.canales) {
      const label = (canal.label || '').split('-->').pop().trim();
      const url = canal.url;

      if (!url) {
        console.warn(`[EVENTOS] Canal sin URL descartado: ${label}`);
        continue;
      }
      if (seen.has(url)) {
        console.log(`[EVENTOS] URL duplicada descartada: ${url}`);
        continue;
      }

      streams.push({
        name: label || evento.deporte,
        title: `${evento.partido} (${evento.deporte})`,
        externalUrl: url,
        behaviorHints: { notWebReady: true, external: true }
      });
      seen.add(url);
    }

    return { streams, chName: evento.partido };
  } catch (e) {
    console.error(`[EVENTOS] Error en getStreams para id=${id}:`, e.message);
    return { streams: [], chName: '' };
  }
}

module.exports = { getStreams };
