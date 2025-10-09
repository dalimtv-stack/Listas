// src/eventos/catalog-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJson } = require('../../api/kv');
const { DateTime } = require('luxon');

async function getCatalog(configId, genre = '') {
  console.time(`[CATALOG EVENTS] Catálogo generado`);

  const configData = await kvGetJson(configId);
  const url = configData?.eventosUrl;
  if (!url) {
    console.timeEnd(`[CATALOG EVENTS] Catálogo generado`);
    return [];
  }

  const eventos = await fetchEventos(url, { modo: genre === 'Mañana' ? 'mañana' : undefined });

  // Calcular hoy y mañana en horario de Madrid
  const hoy = DateTime.now().setZone('Europe/Madrid').startOf('day');
  const mañana = hoy.plus({ days: 1 });

  let filteredEventos;
  if (genre === 'Mañana') {
    filteredEventos = eventos.filter(ev => {
      const fechaEv = DateTime.fromFormat(ev.dia, 'dd/LL/yyyy', { zone: 'Europe/Madrid' });
      return fechaEv.hasSame(mañana, 'day');
    });
  } else {
    filteredEventos = eventos.filter(ev => {
      const fechaEv = DateTime.fromFormat(ev.dia, 'dd/LL/yyyy', { zone: 'Europe/Madrid' });
      return fechaEv.hasSame(hoy, 'day');
    });
  }

  const resultado = filteredEventos.map(ev => ({
    id: `Heimdallr_evt_${configId}_${normalizeId(ev)}`,
    type: 'tv',
    name: `${ev.partido} (${ev.deporte})`,
    poster: ev.poster || `https://dummyimage.com/300x450/000000/ffffff.png&text=${encodeURIComponent(ev.hora)}`,
    description: `${ev.hora} • ${ev.dia} • ${ev.competicion} (${ev.deporte})`,
    producer: `${ev.canal}`,
    background: null
  }));

  console.info(`[CATALOG EVENTS] Eventos generados: ${resultado.length} (filtro: ${genre || 'ninguno'})`);
  console.timeEnd(`[CATALOG EVENTS] Catálogo generado`);
  return resultado;
}

module.exports = { getCatalog };
