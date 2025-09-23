// src/eventos/utils-events.js
'use strict';

// Normaliza a ASCII seguro: quita diacríticos, mantiene [A-Za-z0-9_]
function normalizeId(ev) {
  const base = `eventos_${ev.dia}_${ev.hora}_${ev.deporte}_${ev.partido}`;
  return base
    .normalize('NFKD')            // descompone acentos
    .replace(/\p{M}/gu, '')       // quita marcas (acentos)
    .replace(/\s+/g, '_')         // espacios a _
    .replace(/[^\w]/g, '');       // solo [A-Za-z0-9_]
}

module.exports = { normalizeId };
