// src/eventos/meta-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJson } = require('../../api/kv'); // leer config desde KV

async function getMeta(id, configId) {
  try {
    const configData = await kvGetJson(configId);
    const url = configData?.eventosUrl;

    if (!url) {
      console.warn(`[EVENTOS] No se encontró eventosUrl en la configuración para configId=${configId}`);
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
    const evento = eventos.find(ev => normalizeId(ev) === id);

    if (!evento) {
      console.warn(`[EVENTOS] Evento no encontrado para id=${id}`);
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
      poster: null,        // si más adelante tienes poster en el scraper, ponlo aquí
      background: null,
      description: `${fechaHora}${competicion}`.trim() || nombre
    };
  } catch (e) {
    console.error(`[EVENTOS] Error en getMeta para id=${id}:`, e.message);
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
