// src/eventos/meta-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJson } = require('../../api/kv');
const { DateTime } = require('luxon');

async function getMeta(id, configId) {
  const configData = await kvGetJson(configId);
  const url = configData?.eventosUrl;

  const prefix = `Heimdallr_evt_${configId}_`;
  const cleanId = id.startsWith(prefix) ? id.slice(prefix.length) : id;

  // 🧠 Detectar si el evento es de mañana
  const esDeManana = cleanId.startsWith(
    DateTime.now().plus({ days: 1 }).setZone('Europe/Madrid').toFormat('ddMMyyyy')
  );

  const eventos = url ? await fetchEventos(url, esDeManana ? { modo: 'mañana' } : {}) : [];

  const evento = eventos.find(ev => normalizeId(ev) === cleanId);
  if (!evento) {
    return {
      id, type: 'tv',
      name: 'Evento no encontrado',
      poster: null, background: null,
      description: 'No hay datos para este evento'
    };
  }

  const nombre = evento.partido || 'Evento';
  const deporte = evento.deporte ? ` (${evento.deporte})` : '';
  const competicion = evento.competicion ? `${evento.competicion}` : '';
  const fechaHora = [evento.hora, evento.dia].filter(Boolean).join('  •  ');

  //console.log('[Meta]', { canal: evento.canal, canales: evento.canales });

  return {
    id, type: 'tv',
    name: `${nombre}`,
    poster: evento.poster || null,
    background: evento.poster || null,
    //producer: evento.canal || (evento.canales?.map(c => c.label).join(', ') || 'Canal desconocido'),
    releaseInfo: evento.canal || (evento.canales?.map(c => c.label).join(', ') || 'Canal desconocido'),
    description: `${fechaHora}\n \n${competicion} ${deporte}`.trim() || nombre
  };
}

module.exports = { getMeta };
