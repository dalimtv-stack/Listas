// src/eventos/utils-events.js
'use strict';

/**
 * Normaliza un evento a un ID seguro y consistente.
 * - Quita acentos/diacríticos
 * - Sustituye espacios por "_"
 * - Elimina caracteres no alfanuméricos
 * 
 * Ejemplo:
 *   { dia: 'Martes', hora: '18:30', deporte: 'Fútbol', partido: 'Udinese VS Palermo' }
 *   => "Martes_1830_Futbol_Udinese_VS_Palermo"
 */
function normalizeId(ev) {
  const base = `${ev.dia}_${ev.hora}_${ev.deporte}_${ev.partido}`;
  return base
    .normalize('NFKD')            // descompone acentos
    .replace(/\p{M}/gu, '')       // elimina marcas de acento
    .replace(/\s+/g, '_')         // espacios a "_"
    .replace(/[^\w]/g, '');       // solo [A-Za-z0-9_]
}

module.exports = { normalizeId };
