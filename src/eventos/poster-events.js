// src/eventos/poster-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJson, kvSetJson } = require('../../api/kv');

// Normaliza nombres de partidos para matching
function normalizeMatchName(matchName) {
  return matchName
    .toLowerCase()
    .replace(/\bvs\b/gi, '-')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Genera variantes abreviadas para fallback
function generateFallbackNames(original, context = '') {
  const normalized = normalizeMatchName(original);
  const variants = [normalized];

  const teamAliases = {
    'atletico de madrid': 'at. madrid',
    'real madrid': 'r. madrid',
    'fc barcelona': 'barça',
    'juventus': 'juve',
    'inter milan': 'inter',
    'ac milan': 'milan',
    'bayern munich': 'bayern',
    'borussia dortmund': 'dortmund',
    'paris saint-germain': 'psg',
    'simulcast': ['multieuropa', 'multichampions'],
    'pekin tournament': 'torneo de pekin',
    'tokyo tournament': 'torneo de tokio'
  };

  let aliasVersion = normalized;

  for (const [full, alias] of Object.entries(teamAliases)) {
    const regex = new RegExp(`\\b${full}\\b`, 'gi');
    if (Array.isArray(alias)) {
      alias.forEach(a => {
        const replaced = aliasVersion.replace(regex, a);
        if (replaced !== aliasVersion) variants.push(replaced);
      });
    } else {
      const replaced = aliasVersion.replace(regex, alias);
      if (replaced !== aliasVersion) variants.push(replaced);
    }
  }

  if (context) {
    const contextNorm = normalizeMatchName(context);
    variants.push(contextNorm);
    if (teamAliases[contextNorm]) {
      const alias = teamAliases[contextNorm];
      if (Array.isArray(alias)) {
        variants.push(...alias.map(normalizeMatchName));
      } else {
        variants.push(normalizeMatchName(alias));
      }
    }
  }

  return [...new Set(variants)];
}

function generatePlaceholdPoster({ hora, deporte, competicion }) {
  const text = `${hora}\n \n${deporte}\n \n${competicion}`;
  return `https://placehold.co/938x1406@3x/999999/80f4eb?text=${encodeURIComponent(text)}&font=poppins&png`;
}

// Scrapea póster desde Movistar Plus+ (sin Puppeteer)
async function scrapePosterUrl({ partido, deporte, competicion }) {
  const cacheKey = `poster:${normalizeMatchName(partido)}`;
  const cached = await kvGetJson(cacheKey);
  if (cached?.posterUrl?.startsWith('http')) return cached.posterUrl;

  try {
    const isTenis = deporte?.toLowerCase() === 'tenis';
    const sourceUrl = isTenis
      ? 'https://www.movistarplus.es/deportes/tenis/donde-ver'
      : 'https://www.movistarplus.es/el-partido-movistarplus';

    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const candidates = generateFallbackNames(partido, competicion);
    let posterUrl = null;

    for (const name of candidates) {
      $('img').each((_, img) => {
        const alt = $(img).attr('alt')?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
        const src = $(img).attr('src')?.toLowerCase() || '';
        if (alt.includes(name) || src.includes(name)) {
          posterUrl = $(img).attr('src');
          return false;
        }
      });
      if (posterUrl) break;
    }

    if (posterUrl?.startsWith('http')) {
      await kvSetJson(cacheKey, { posterUrl, createdAt: Date.now() }, { ttl: 86400 });
      return posterUrl;
    }

    return null;
  } catch {
    return null;
  }
}

// FIX: Genera todos los pósters agrupando por posterUrl
async function generarPostersConHora(partidos) {
  const agrupados = {};

  for (const { partido, hora, deporte, competicion } of partidos) {
    const posterUrl = await scrapePosterUrl({ partido, deporte, competicion });
    const key = posterUrl || generatePlaceholdPoster({ hora, deporte, competicion });

    if (!agrupados[key]) agrupados[key] = [];
    agrupados[key].push({ partido, hora, deporte, competicion });
  }

  const resultados = [];

  for (const [posterUrl, grupo] of Object.entries(agrupados)) {
    const horas = grupo.map(g => g.hora);
    const endpoint = `https://listas-sand.vercel.app/poster-con-hora?url=${encodeURIComponent(posterUrl)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horas })
    });

    const generados = await res.json(); // [{ hora, url }]
    for (const { hora, url } of generados) {
      const partido = grupo.find(g => g.hora === hora)?.partido;
      const deporte = grupo.find(g => g.hora === hora)?.deporte;
      const competicion = grupo.find(g => g.hora === hora)?.competicion;

      resultados.push({
        id: `poster:${normalizeMatchName(partido)}:${hora}`,
        partido,
        hora,
        deporte,
        competicion,
        posterUrl: url
      });
    }
  }

  return resultados;
}

module.exports = { generarPostersConHora };
