'use strict';

function normalizeId(ev) {
  return `eventos_${ev.dia}_${ev.hora}_${ev.deporte}_${ev.partido}`
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, ''); // conserva letras con acentos y números
}

module.exports = { normalizeId };
