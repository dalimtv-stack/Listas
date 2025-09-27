// src/eventos/poster-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJson, kvSetJson } = require('../../api/kv');

function normalizeMatchName(matchName) {
  return matchName
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  const text = `${hora}`;
  return `https://dummyimage.com/300x450/000/fff&text=${encodeURIComponent(text)}`;
}

const posterCache = new Map();

async function scrapePosterForMatch({ partido, hora, deporte, competicion }) {
  const finalCacheKey = `posterFinal:${normalizeMatchName(partido)}:${hora}`;
  const finalCached = await kvGetJson(finalCacheKey);
  if (finalCached?.finalUrl?.startsWith('data:image')) {
    return finalCached.finalUrl;
  }

  const movistarCacheKey = `poster:${normalizeMatchName(partido)}`;
  const cachedMovistar = await kvGetJson(movistarCacheKey);

  let posterUrl = cachedMovistar?.posterUrl;
  if (!posterUrl) {
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
      console.info(`[Poster] Probando variantes para "${partido}":`, candidates);

      for (const name of candidates) {
        const nameRegex = new RegExp(name.replace(/[-]/g, '[ -]'), 'i');
        $('img').each((_, img) => {
          const alt = $(img).attr('alt')?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
          const src = $(img).attr('src')?.toLowerCase() || '';
          if (nameRegex.test(alt) || nameRegex.test(src)) {
            posterUrl = $(img).attr('src');
            console.info(`[Poster] Coincidencia encontrada con "${name}" → ${posterUrl}`);
            return false;
          }
        });
        if (posterUrl) break;
      }

      if (!posterUrl) {
        console.warn(`[Poster] No se encontró imagen para: ${partido} (${competicion})`);
      }

      if (posterUrl?.startsWith('http')) {
        await kvSetJson(movistarCacheKey, { posterUrl, createdAt: Date.now() }, { ttl: 86400 });
      }
    } catch (err) {
      console.error('[Poster] Error scraping:', err.message);
    }
  }

  if (!posterUrl || !posterUrl.startsWith('http')) {
    return generatePlaceholdPoster({ hora, deporte, competicion });
  }

  if (!posterCache.has(posterUrl)) {
    posterCache.set(posterUrl, new Map());
  }

  const horaMap = posterCache.get(posterUrl);
  if (horaMap.has(hora)) {
    return horaMap.get(hora);
  }

  const endpoint = `https://listas-sand.vercel.app/poster-con-hora?url=${encodeURIComponent(posterUrl).png}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  let generados;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horas: [hora] }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    generados = await res.json();
  } catch (err) {
    console.error('[Poster] Error al generar:', err.message);
    return generatePlaceholdPoster({ hora, deporte, competicion });
  }

  if (!Array.isArray(generados)) {
    console.error('[Poster] Respuesta inválida de poster-con-hora:', generados);
    return generatePlaceholdPoster({ hora, deporte, competicion });
  }

  const generado = generados.find(p => p.hora === hora);
  const finalUrl = generado?.url || generatePlaceholdPoster({ hora, deporte, competicion });

  horaMap.set(hora, finalUrl);
  await kvSetJson(finalCacheKey, { finalUrl, createdAt: Date.now() }, { ttl: 86400 });

  return finalUrl;
}

module.exports = {
  scrapePosterForMatch,
  generatePlaceholdPoster
};
