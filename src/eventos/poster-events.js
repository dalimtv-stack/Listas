// src/eventos/poster-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJson, kvSetJson } = require('../../api/kv');

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
    'real madrid': 'r. madrid',
    'real sociedad': 'r. sociedad',
    'fc barcelona': 'barça',
    'rayo vallecano': 'rayo',
    'deportivo alaves': 'alaves',
    'cadiz': 'cádiz',
    'celta de vigo': 'celta',
    'athletic club': 'athletic',
    'manchester united': 'man united',
    'manchester city': 'man city',
    'tottenham hotspur': 'spurs',
    'newcastle united': 'newcastle',
    'west ham united': 'west ham',
    'brighton & hove albion': 'brighton',
    'aston villa': 'villa',
    'crystal palace': 'palace',
    'wolverhampton wanderers': 'wolves',
    'nottingham forest': 'forest',
    'sheffield united': 'sheffield',
    'luton town': 'luton',
    'juventus': 'juve',
    'inter milan': 'inter',
    'ac milan': 'milan',
    'bayern munich': 'bayern',
    'borussia dortmund': 'dortmund',
    'rb leipzig': 'leipzig',
    'bayer leverkusen': 'leverkusen',
    'borussia monchengladbach': 'gladbach',
    'eintracht frankfurt': 'frankfurt',
    'vfl wolfsburg': 'wolfsburg',
    'fc koln': 'cologne',
    'werder bremen': 'bremen',
    'fc augsburg': 'augsburg',
    'union berlin': 'union',
    'paris saint-germain': 'psg',
    'olympique lyonnais': 'lyon',
    'olympique de marseille': 'marseille',
    'as monaco': 'monaco',
    'rc lens': 'lens'
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
  const cacheKey = `poster:${normalizeMatchName(partido)}`;
  const cached = await kvGetJson(cacheKey);
  if (cached && typeof cached === 'string' && cached.startsWith('http')) {
    console.log(JSON.stringify({
      level: 'info',
      scope: 'poster-events',
      match: partido,
      poster: cached,
      cached: true,
      status: 'cached'
    }));
    return cached;
  }

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
      await kvSetJson(cacheKey, posterUrl, { ttl: 24 * 60 * 60 });
      console.log(JSON.stringify({
        level: 'info',
        scope: 'poster-events',
        match: partido,
        variant: matchedVariant,
        poster: posterUrl,
        cached: cacheKey,
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
