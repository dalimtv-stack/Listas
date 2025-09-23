// src/eventos/catalog-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJson } = require('../../api/kv');

async function getCatalog(configId) {
  const configData = await kvGetJson(configId);
  const url = configData?.eventosUrl;
  if (!url) return [];

  const eventos = await fetchEventos(url);
  return eventos.map(ev => ({
    id: `Heimdallr_evt_${configId}_${normalizeId(ev)}`, // prefijo distinto
    type: 'tv',
    name: `${ev.partido} (${ev.deporte})`,
    poster: `https://placehold.co/938x1406@3x/999999/80f4eb?text=${encodeURIComponent(
      `${ev.hora}\n\n${ev.deporte}\n\n${ev.competicion}\n\n${ev.partido}`
    )}&font=poppins&png`,
    description: `${ev.dia} ${ev.hora} - ${ev.competicion}\nCanales: ${ev.canales.map(c => c.label).join(', ')}`,
    background: null
  }));
}

module.exports = { getCatalog };
