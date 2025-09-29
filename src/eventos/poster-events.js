// src/eventos/poster-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJsonTTL, kvSetJsonTTL } = require('../../api/kv');

function normalizeMatchName(matchName) {
  return String(matchName)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generatePlaceholdPoster({ hora }) {
  return `https://dummyimage.com/300x450/000/fff&text=${encodeURIComponent(String(hora))}`;
}

// Cacheamos cualquier PNG que no sea placeholder
function isCacheablePosterUrl(url) {
  return typeof url === 'string'
    && url.toLowerCase().endsWith('.png')
    && !url.includes('dummyimage.com');
}

// Normalizar a URL absoluta si viene como "posters/xxx.png"
function normalizeBlobUrl(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return `https://kb24ncicobqdaseh.public.blob.vercel-storage.com/${url.replace(/^\/+/, '')}`;
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
    'simulcast': ['multieuropa', 'multichampions']
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
  if (context) variants.push(normalizeMatchName(context));
  return [...new Set(variants)];
}

async function buscarPosterEnFuente(url, candidates) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    for (const name of candidates) {
      const nameRegex = new RegExp(name.replace(/[-]/g, '[ -]'), 'i');
      let encontrado = null;
      $('img').each((_, img) => {
        const alt = $(img).attr('alt')?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
        const src = $(img).attr('src')?.toLowerCase() || '';
        if (nameRegex.test(alt) || nameRegex.test(src)) {
          encontrado = $(img).attr('src');
          return false;
        }
      });
      if (encontrado?.startsWith('http')) {
        console.info(`[Poster] Coincidencia encontrada en ${url} → ${encontrado}`);
        return encontrado;
      }
    }
  } catch (err) {
    console.warn(`[Poster] Fallo al buscar en ${url}: ${err.message}`);
  }
  return null;
}

// --- KV helpers ---

async function kvReadPostersHoyMap() {
  const data = await kvGetJsonTTL('postersBlobHoy');
  return data && typeof data === 'object' ? data : {};
}

async function kvWritePostersHoyMap(mergedMap) {
  await kvSetJsonTTL('postersBlobHoy', mergedMap, 86400);
  console.info(`[Poster] KV actualizado con ${Object.keys(mergedMap).length} entradas`);
}

// --- Generación de un póster con hora ---

async function generatePosterWithHour({ partido, hora, deporte, competicion }) {
  let posterSourceUrl;
  try {
    const isTenis = deporte?.toLowerCase() === 'tenis';
    const candidates = generateFallbackNames(partido, competicion);
    const fuentes = isTenis
      ? [
          'https://www.movistarplus.es/deportes/tenis/donde-ver',
          'https://www.movistarplus.es/deportes?conf=iptv',
          'https://www.movistarplus.es/el-partido-movistarplus'
        ]
      : [
          'https://www.movistarplus.es/deportes?conf=iptv',
          'https://www.movistarplus.es/el-partido-movistarplus'
        ];
    for (const fuente of fuentes) {
      posterSourceUrl = await buscarPosterEnFuente(fuente, candidates);
      if (posterSourceUrl) break;
    }
  } catch (err) {
    console.error('[Poster] Error scraping:', err.message);
  }
  if (!posterSourceUrl?.startsWith('http')) {
    return generatePlaceholdPoster({ hora });
  }
  const endpoint = `https://listas-sand.vercel.app/poster-con-hora?url=${encodeURIComponent(posterSourceUrl)}`;
  let generados;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horas: [hora] })
    });
    generados = await res.json();
  } catch (err) {
    console.error('[Poster] Error al generar con hora:', err.message);
    return generatePlaceholdPoster({ hora });
  }
  if (!Array.isArray(generados)) {
    return generatePlaceholdPoster({ hora });
  }
  const generado = generados.find(p => p.hora === hora);
  const finalUrl = normalizeBlobUrl(generado?.url);
  return isCacheablePosterUrl(finalUrl) ? finalUrl : generatePlaceholdPoster({ hora });
}

// --- API principal usada por scraper-events.js ---

async function scrapePosterForMatch({ partido, hora, deporte, competicion }) {
  const partidoNorm = normalizeMatchName(partido);

  // Leer KV actual
  let postersMap = await kvReadPostersHoyMap();
  const cached = postersMap[partidoNorm];
  if (typeof cached === 'string' && cached.length > 0) {
    return cached;
  }

  // Generar nuevo póster
  const url = await generatePosterWithHour({ partido, hora, deporte, competicion });

  if (isCacheablePosterUrl(url)) {
    // Releer KV justo antes de escribir para evitar pisar
    postersMap = await kvReadPostersHoyMap();
    const merged = { ...postersMap, [partidoNorm]: url };
    await kvWritePostersHoyMap(merged);
  }

  return url;
}

module.exports = {
  scrapePosterForMatch,
  generatePlaceholdPoster
};
