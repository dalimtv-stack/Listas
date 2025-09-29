// src/eventos/poster-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJson, kvSetJsonTTLIfChanged } = require('../../api/kv');

function normalizeMatchName(matchName) {
  return matchName
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Acepta IDs alfanuméricos con guión/guión bajo antes del sufijo _HH_MM.png
function isBlobPosterUrl(url) {
  return typeof url === 'string' &&
    /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/posters\/[a-z0-9_-]+_[0-9]{2}_[0-9]{2}\.png$/i.test(url);
}

function generatePlaceholdPoster({ hora }) {
  return `https://dummyimage.com/300x450/000/fff&text=${encodeURIComponent(String(hora))}`;
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

  if (context) {
    variants.push(normalizeMatchName(context));
  }

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
  const wrapper = await kvGetJson('postersBlobHoy');
  return wrapper && typeof wrapper === 'object' && wrapper.data ? wrapper.data : {};
}

async function kvWritePostersHoyMap(mergedMap) {
  // mergedMap es plano: { "partido": "url", ... }
  await kvSetJsonTTLIfChanged('postersBlobHoy', mergedMap, 86400);
  console.info(`[Poster] KV actualizado con ${Object.keys(mergedMap).length} entradas`);
}

// --- Generación de un póster con hora (sin escribir en KV aquí) ---

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
  const finalUrl = generado?.url;
  return isBlobPosterUrl(finalUrl) ? finalUrl : generatePlaceholdPoster({ hora });
}

// --- Concurrencia por lotes segura (sin tragarse promesas) ---

async function processInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const res = await Promise.all(batch.map(fn));
    results.push(...res);
  }
  return results;
}

// --- Orquestación ---

async function scrapePostersConcurrenciaLimitada(eventos, limite = 4) {
  const postersMap = await kvReadPostersHoyMap();
  const updates = {};

  // Procesar eventos en lotes
  await processInBatches(eventos, limite, async (evento) => {
    const partidoNorm = normalizeMatchName(evento.partido);
    const cached = postersMap[partidoNorm];

    if (isBlobPosterUrl(cached)) {
      evento.poster = cached;
      return evento;
    }

    const url = await generatePosterWithHour(evento);
    evento.poster = url;

    if (isBlobPosterUrl(url)) {
      updates[partidoNorm] = url;
    }
    return evento;
  });

  // Escritura única al final con mapa plano
  if (Object.keys(updates).length > 0) {
    const merged = { ...postersMap, ...updates };
    await kvWritePostersHoyMap(merged);
  } else {
    console.info('[Poster] KV sin cambios (no hay nuevas entradas válidas)');
  }

  return eventos;
}

async function scrapePosterForMatch({ partido, hora, deporte, competicion }) {
  const postersMap = await kvReadPostersHoyMap();
  const partidoNorm = normalizeMatchName(partido);
  const cached = postersMap[partidoNorm];
  if (isBlobPosterUrl(cached)) {
    return cached;
  }
  return await generatePosterWithHour({ partido, hora, deporte, competicion });
}

module.exports = {
  scrapePosterForMatch,
  scrapePostersConcurrenciaLimitada,
  generatePlaceholdPoster
};
