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

// Genera variantes abreviadas para fallback
function generateFallbackNames(original) {
  const normalized = normalizeMatchName(original);
  const variants = [normalized];

  const teamAliases = {
    'atletico de madrid': 'at. madrid',
    'real sociedad': 'r. sociedad',
    'rayo vallecano': 'rayo',
    'deportivo alaves': 'alaves',
    'real madrid': 'r. madrid',
    'fc barcelona': 'barça',
    'girona': 'girona',
    'getafe': 'getafe',
    'mallorca': 'mallorca',
    'sevilla': 'sevilla',
    'valencia': 'valencia'
  };

  let aliasVersion = normalized;
  for (const [full, alias] of Object.entries(teamAliases)) {
    const regex = new RegExp(`\\b${full}\\b`, 'gi');
    aliasVersion = aliasVersion.replace(regex, alias);
  }

  if (aliasVersion !== normalized) variants.push(aliasVersion);

  return [...new Set(variants)];
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

    const candidates = generateFallbackNames(partido);
    let posterUrl = null;
    let matchedVariant = null;

    for (const name of candidates) {
      $('img').each((_, img) => {
        const alt = $(img).attr('alt')?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
        const src = $(img).attr('src')?.toLowerCase() || '';
        if (alt.includes(name) || src.includes(name)) {
          posterUrl = $(img).attr('src');
          matchedVariant = name;
          return false; // break loop
        }
      });
      if (posterUrl) break;
    }

    if (posterUrl && posterUrl.startsWith('http')) {
      console.log(JSON.stringify({
        level: 'info',
        scope: 'poster-events',
        match: partido,
        variant: matchedVariant,
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
        tried: candidates,
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
