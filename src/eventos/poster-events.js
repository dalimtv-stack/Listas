// src/eventos/poster-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');

// Normaliza nombres de partidos para matching
function normalizeMatchName(matchName) {
  return matchName
    .toLowerCase()
    .replace(/\bvs\b/gi, '-') // Cambia "VS" por "-"
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Elimina acentos
    .replace(/\s+/g, ' ')
    .trim();
}

// Genera un póster de fallback con hora, deporte y competición
function generatePlaceholdPoster({ hora, deporte, competicion }) {
  const text = `${hora}\n \n${deporte}\n \n${competicion}`;
  return `https://placehold.co/938x1406@3x/999999/80f4eb?text=${encodeURIComponent(text)}&font=poppins&png`;
}

// Scrapea póster para un partido desde Movistar Plus+ (sin Puppeteer)
async function scrapePosterForMatch({ partido, hora, deporte, competicion }) {
  try {
    const res = await fetch('https://www.movistarplus.es/el-partido-movistarplus');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const normalizedPartido = normalizeMatchName(partido);
    let posterUrl = null;

    $('img').each((_, img) => {
      const alt = $(img).attr('alt')?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
      const src = $(img).attr('src')?.toLowerCase() || '';
      if (alt.includes(normalizedPartido) || src.includes(normalizedPartido)) {
        posterUrl = $(img).attr('src');
        return false; // break loop
      }
    });

    if (posterUrl && posterUrl.startsWith('http')) {
      console.log(JSON.stringify({
        level: 'info',
        scope: 'poster-events',
        match: partido,
        poster: posterUrl,
        status: 'found'
      }));
      return posterUrl;
    } else {
      const fallback = generatePlaceholdPoster({ hora, deporte, competicion });
      console.log(JSON.stringify({
        level: 'warn',
        scope: 'poster-events',
        match: partido,
        poster: fallback,
        status: 'fallback'
      }));
      return fallback;
    }
  } catch (err) {
    const fallback = generatePlaceholdPoster({ hora, deporte, competicion });
    console.error(JSON.stringify({
      level: 'error',
      scope: 'poster-events',
      match: partido,
      error: err.stack || err.message,
      poster: fallback,
      status: 'error-fallback'
    }));
    return fallback;
  }
}

module.exports = { scrapePosterForMatch };
