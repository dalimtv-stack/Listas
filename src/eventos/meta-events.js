// src/eventos/meta-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJson } = require('../../api/kv');

async function getMeta(id, configId) {
  const configData = await kvGetJson(configId);
  const url = configData?.eventosUrl;
  const eventos = url ? await fetchEventos(url, { modo: 'mañana' }) : [];

  const prefix = `Heimdallr_evt_${configId}_`;
  const cleanId = id.startsWith(prefix) ? id.slice(prefix.length) : id;

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
  const competicion = evento.competicion ? ` • ${evento.competicion}` : '';
  const fechaHora = [evento.hora,evento.dia].filter(Boolean).join(' • ');

  return {
    id, type: 'tv',
    name: `${nombre}${deporte}`,
    poster: null, background: null,
    description: `${fechaHora}${competicion}${deporte}`.trim() || nombre
  };
}

module.exports = { getMeta };
