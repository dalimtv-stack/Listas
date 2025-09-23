'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { resolveM3uUrl } = require('../../api/resolve');

async function getStreams(id, configId) {
  const url = await resolveM3uUrl(configId);
  if (!url) return { streams: [], chName: '' };

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
