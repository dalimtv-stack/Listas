// src/eventos/meta-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJson } = require('../../api/kv');

async function getMeta(id, configId) {
  try {
    const configData = await kvGetJson(configId);
    const url = configData?.eventosUrl;

    if (!url) {
      return {
        id,
        type: 'tv',
        name: 'Evento no disponible',
        poster: null,
        background: null,
        description: 'Sin URL de eventos configurada'
      };
    }

    const eventos = await fetchEventos(url);

    // limpiar prefijo Heimdallr_evento_<configId>_
    const prefix = `Heimdallr_evento_${configId}_`;
    const cleanId = id.startsWith(prefix) ? id.slice(prefix.length) : id;

    const evento = eventos.find(ev => normalizeId(ev) === cleanId);

    if (!evento) {
      return {
        id,
        type: 'tv',
        name: 'Evento no encontrado',
        poster: null,
        background: null,
        description: 'No hay datos para este evento'
      };
    }

    const nombre = evento.partido || 'Evento';
    const deporte = evento.deporte ? ` (${evento.deporte})` : '';
    const competicion = evento.competicion ? ` • ${evento.competicion}` : '';
    const fechaHora = [evento.dia, evento.hora].filter(Boolean).join(' ');

    return {
      id,
      type: 'tv',
      name: `${nombre}${deporte}`,
      poster: null,
      background: null,
      description: `${fechaHora}${competicion}`.trim() || nombre
    };
  } catch (e) {
    return {
      id,
      type: 'tv',
      name: 'Evento no disponible',
      poster: null,
      background: null,
      description: 'Error al cargar datos del evento'
    };
  }
}

module.exports = { getMeta };
