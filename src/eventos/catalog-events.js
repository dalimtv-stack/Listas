// src/eventos/catalog-events.js
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
    poster: `https://dummyimage.com/300x450/000/fff&text=${encodeURIComponent(
      (ev.deporte || '').normalize('NFKD').replace(/\p{M}/gu, '')
    )}`,
    description: `${ev.dia} ${ev.hora} - ${ev.competicion}\nCanales: ${ev.canales.map(c => c.label).join(', ')}`,
    background: null
  }));
}

module.exports = { getCatalog };
