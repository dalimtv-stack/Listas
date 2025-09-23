// src/eventos/catalog-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { getConfig } = require('../configStore'); // para leer la config guardada en KV

async function getCatalog(configId) {
  // Recuperamos la URL de eventos desde la configuración
  const config = getConfig(configId) || {};
  const url = config.eventosUrl;

  if (!url) {
    console.warn(`[EVENTOS] No se encontró eventosUrl en la configuración para configId=${configId}`);
    return [];
  }

  const eventos = await fetchEventos(url);

  return eventos.map(ev => ({
    id: normalizeId(ev),
    type: 'tv',
    name: `${ev.partido} (${ev.deporte})`,
    poster: `https://dummyimage.com/300x450/000/fff&text=${encodeURIComponent(ev.deporte)}`,
    description: `${ev.dia} ${ev.hora} - ${ev.competicion}\nCanales: ${ev.canales.map(c => c.label).join(', ')}`,
    background: null
  }));
}

module.exports = { getCatalog };
