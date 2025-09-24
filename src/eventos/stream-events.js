// src/eventos/stream-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJson } = require('../../api/kv');

async function getStreams(id, configId) {
  const configData = await kvGetJson(configId);
  const url = configData?.eventosUrl;
  const eventos = url ? await fetchEventos(url) : [];

  const prefix = `Heimdallr_evt_${configId}_`;
  const cleanId = id.startsWith(prefix) ? id.slice(prefix.length) : id;

  const evento = eventos.find(ev => normalizeId(ev) === cleanId);
  if (!evento) return { streams: [], chName: '' };

  const seen = new Set();
  const streams = [];
  for (const canal of evento.canales) {
    const rawLabel = canal.label || evento.deporte;
    const url = canal.url;
    if (!url || seen.has(url)) continue;

    const canalName = rawLabel.split('-->').shift().trim();
    const temporal = rawLabel.split('-->').pop().trim();

    streams.push({
      name: canalName,
      title: `${evento.partido} (${evento.deporte})\nFormato:  Acestream\nCanal:  ${canalName}\nProveedor:  ${temporal}`,
      externalUrl: url,
      behaviorHints: { notWebReady: true, external: true }
    });
    seen.add(url);
  }

  return { streams, chName: evento.partido };
}

module.exports = { getStreams };
