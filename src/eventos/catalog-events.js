// src/eventos/catalog-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJson } = require('../../api/kv');

// Función para comprobar si placehold.co está disponible
async function isPlaceholdAvailable() {
  try {
    const response = await fetch('https://placehold.co/100x100', { method: 'HEAD', timeout: 5000 });
    return response.ok; // Devuelve true si la respuesta es 200-299
  } catch (error) {
    console.error('Error checking placehold.co availability:', error.message);
    return false; // Si hay error (timeout, red, etc.), usar dummyimage
  }
}

async function getCatalog(configId) {
  const configData = await kvGetJson(configId);
  const url = configData?.eventosUrl;
  if (!url) return [];

  // Comprobar disponibilidad de placehold.co
  const usePlacehold = await isPlaceholdAvailable();

  const eventos = await fetchEventos(url);
  return eventos.map(ev => {
    // Definir la URL del póster según la disponibilidad
    const posterUrl = usePlacehold
      ? `https://placehold.co/938x1406@3x/999999/80f4eb?text=${encodeURIComponent(
          `${ev.hora}\n \n${ev.deporte}\n \n${ev.competicion}\n \n${ev.partido}`
        )}&font=poppins&png`
      : `https://dummyimage.com/300x450/000/fff&text=${encodeURIComponent(
          (ev.deporte || '').normalize('NFKD').replace(/\p{M}/gu, '')
        )}`;

    return {
      id: `Heimdallr_evt_${configId}_${normalizeId(ev)}`, // prefijo distinto
      type: 'tv',
      name: `${ev.partido} (${ev.deporte})`,
      poster: posterUrl,
      description: `${ev.dia} ${ev.hora} - ${ev.competicion}`,
      background: null
    };
  });
}

module.exports = { getCatalog };
