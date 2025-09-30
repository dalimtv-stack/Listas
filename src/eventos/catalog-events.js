// src/eventos/catalog-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJson } = require('../../api/kv');

async function getCatalog(configId) {
  console.time(`[CATALOG EVENTS] Catálogo generado`);

  const configData = await kvGetJson(configId);
  const url = configData?.eventosUrl;
  if (!url) {
    console.timeEnd(`[CATALOG EVENTS] Catálogo generado`);
    return [];
  }

  const eventos = await fetchEventos(url);
  const resultado = eventos.map(ev => ({
    id: `Heimdallr_evt_${configId}_${normalizeId(ev)}`,
    type: 'tv',
    name: `${ev.partido} (${ev.deporte})`,
    poster: ev.poster || `https://dummyimage.com/300x450/000/fff&text=${encodeURIComponent(ev.hora)}`,
    description: `${ev.hora} · ${ev.dia} · ${ev.competicion} (${ev.deporte})`,
    background: null
  }));

  console.info(`[CATALOG EVENTS] Eventos generados: ${resultado.length}`);
  console.timeEnd(`[CATALOG EVENTS] Catálogo generado`);
  return resultado;
}

module.exports = { getCatalog };
