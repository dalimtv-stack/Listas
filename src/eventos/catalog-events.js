'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { ADDON_PREFIX } = require('../config');

async function getCatalog(configId) {
  const config = await getConfig(configId);
  const url = config?.dailyUrl?.trim();
  if (!url) return [];

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
