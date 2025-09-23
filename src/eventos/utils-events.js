'use strict';

function normalizeId(ev) {
  return `eventos_${ev.dia}_${ev.hora}_${ev.deporte}_${ev.partido}`
    .replace(/\s+/g, '_')
    .replace(/[^\w]/g, '');
}

module.exports = { normalizeId };
