// src/eventos/catalog-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJson } = require('../../api/kv'); // leer config desde KV

async function getCatalog(configId) {
  const configData = await kvGetJson(configId);
  const url = configData?.eventosUrl;

  if (!url) {
    console.warn(`[EVENTOS] No se encontró eventosUrl en la configuración para configId=${configId}`);
    return [];
  }

  const eventos = await fetchEventos(url);

  return eventos.map(ev => ({
    id: `Heimdallr_evento_${configId}_${normalizeId(ev)}`, // singular
    type: 'tv',
    name: `${ev.partido} (${ev.deporte})`,
    poster: `https://dummyimage.com/300x450/000/fff&text=${encodeURIComponent(ev.deporte)}`,
    description: `${ev.dia} ${ev.hora} - ${ev.competicion}\nCanales: ${ev.canales.map(c => c.label).join(', ')}`,
    background: null
  }));
}

module.exports = { getCatalog };
