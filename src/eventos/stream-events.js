// src/eventos/stream-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { getConfig } = require('../configStore'); // para leer la config guardada en KV

async function getStreams(id, configId) {
  // Recuperamos la URL de eventos desde la configuración
  const config = getConfig(configId) || {};
  const url = config.eventosUrl;

  if (!url) {
    console.warn(`[EVENTOS] No se encontró eventosUrl en la configuración para configId=${configId}`);
    return { streams: [], chName: '' };
  }

  const eventos = await fetchEventos(url);
  const evento = eventos.find(ev => normalizeId(ev) === id);
  if (!evento) return { streams: [], chName: '' };

  const streams = evento.canales.map(canal => ({
    name: canal.label.split('-->').pop().trim(),
    title: `${evento.partido} (${evento.deporte})`,
    externalUrl: canal.url,
    behaviorHints: { notWebReady: true, external: true }
  }));

  return { streams, chName: evento.partido };
}

module.exports = { getStreams };
