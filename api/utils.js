// api/utils.js
'use strict';

const crypto = require('crypto');
const fetch = require('node-fetch');
const { DEFAULT_CONFIG_ID } = require('../src/config');

function normalizeCatalogName(name) {
  if (!name) return '';

  let nameFormateado = name
    // elimina texto entre paréntesis, ej. "Película (2023)" → "Película"
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    // elimina etiquetas de calidad (HD, 1080p, etc.)
    .replace(/\(?\b(?:SD|HD|FHD|QHD|2K|UHD|4K|480p|480|540p|540|720p|720|1080p|1080|1440p|1440|2160p|2160|4320p|4320)\b\)?/gi, '')
    // normaliza espacios múltiples
    .replace(/\s+/g, ' ')
    .trim();

  return nameFormateado;
}

function getM3uHash(m3uUrl) {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await fetch(m3uUrl, { method: 'GET', timeout: 5000 });
      if (!response.ok) throw new Error(`Error fetching M3U: ${response.status}`);
      const m3uText = await response.text();
      const hash = crypto.createHash('md5').update(m3uText).digest('hex');
      console.log(`[UTILS] Generado hash para ${m3uUrl}: ${hash}`);
      resolve(hash);
    } catch (e) {
      console.error(`[UTILS] Error generando hash para ${m3uUrl}:`, e.message);
      resolve(crypto.createHash('md5').update(m3uUrl || '').digest('hex'));
    }
  });
}

function extractConfigIdFromUrl(req) {
  const m = req.url.match(/^\/([^/]+)\/(manifest\.json|catalog|meta|stream)\b/);
  return m && m[1] ? m[1] : DEFAULT_CONFIG_ID;
}

function parseCatalogRest(restRaw) {
  const segments = restRaw.split('/');
  const id = segments.shift();
  const extra = {};
  for (const seg of segments) {
    const [k, v] = seg.split('=');
    if (!k || v === undefined) continue;
    const key = decodeURIComponent(k.trim());
    const val = decodeURIComponent(v.trim());
    if (key === 'genre' || key === 'search') extra[key] = val;
  }
  return { id, extra };
}
module.exports = {
  normalizeCatalogName,
  getM3uHash,
  extractConfigIdFromUrl,
  parseCatalogRest
};
