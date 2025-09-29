// src/eventos/poster-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJson, kvSetJsonTTLIfChanged } = require('../../api/kv');

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

// Solo cacheamos si no es el placeholder y parece una imagen final
function isCacheablePosterUrl(url) {
  return typeof url === 'string'
    && !url.includes('dummyimage.com')
    && url.toLowerCase().endsWith('.png');
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

function normalizeBlobUrl(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  // Si viene como "posters/xxx.png", anteponer host del bucket
  return `https://kb24ncicobqdaseh.public.blob.vercel-storage.com/${url.replace(/^\/+/, '')}`;
}

// --- KV helpers ---

async function kvReadPostersHoyMap() {
  try {
    const wrapper = await kvGetJson('postersBlobHoy');
    if (wrapper && typeof wrapper === 'object' && wrapper.data && typeof wrapper.data === 'object') {
      console.info(`[Poster] KV leído: postersBlobHoy con ${Object.keys(wrapper.data).length} entradas`);
      return wrapper.data;
    }
    console.info('[Poster] KV vacío o sin datos válidos, devolviendo mapa vacío');
    return {};
  } catch (err) {
    console.error('[Poster] Error al leer KV postersBlobHoy:', err.message);
    return {};
  }
}

async function kvWritePostersHoyMap(mergedMap) {
  try {
    console.info(`[Poster] Intentando escribir en KV: ${JSON.stringify(mergedMap)}`);
    await kvSetJsonTTLIfChanged('postersBlobHoy', mergedMap, 86400);
    console.info(`[Poster] KV actualizado con ${Object.keys(mergedMap).length} entradas`);
  } catch (err) {
    console.error('[Poster] Error al escribir en KV postersBlobHoy:', err.message);
  }
}

// --- Generación de un póster con hora (sin escribir en KV aquí) ---

async function generatePosterWithHour({ partido, hora, deporte, competicion }) {
  console.info(`[Poster] Generando poster para ${partido} (${hora})`);
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
    console.warn(`[Poster] No se encontró póster en fuente para ${partido}, devolviendo fallback`);
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
    if (!res.ok) throw new Error(`HTTP ${res.status} en poster-con-hora`);
    generados = await res.json();
  } catch (err) {
    console.error(`[Poster] Error al generar con hora para ${partido}:`, err.message);
    return generatePlaceholdPoster({ hora });
  }

  if (!Array.isArray(generados)) {
    console.error(`[Poster] Respuesta inválida de poster-con-hora para ${partido}:`, generados);
    return generatePlaceholdPoster({ hora });
  }

  const generado = generados.find(p => p.hora === hora);
  const finalUrl = normalizeBlobUrl(generado?.url);
  if (isCacheablePosterUrl(finalUrl)) {
    console.info(`[Poster] URL válida generada para ${partido}: ${finalUrl}`);
    return finalUrl;
  }

  console.warn(`[Poster] URL no válida para ${partido}: ${finalUrl}, devolviendo fallback`);
  return generatePlaceholdPoster({ hora });
}

// --- Concurrencia simple por lotes ---

async function processInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (item, index) => {
        try {
          console.info(`[Poster] Procesando evento ${index + 1}/${batch.length} del lote: ${item.partido}`);
          return await fn(item);
        } catch (err) {
          console.error(`[Poster] Error procesando evento ${item.partido}:`, err.message);
          item.poster = generatePlaceholdPoster({ hora: item.hora });
          return item;
        }
      })
    );
    results.push(...batchResults);
  }
  return results;
}

// --- Orquestación ---

async function scrapePostersConcurrenciaLimitada(eventos, limite = 4) {
  console.info(`[Poster] Iniciando procesamiento de ${eventos.length} eventos`);
  const postersMap = await kvReadPostersHoyMap();
  const updates = {};

  await processInBatches(eventos, limite, async (evento) => {
    const partidoNorm = normalizeMatchName(evento.partido);
    const cached = postersMap[partidoNorm];

    if (isCacheablePosterUrl(cached)) {
      console.info(`[Poster] Usando KV existente para ${partidoNorm}: ${cached}`);
      evento.poster = cached;
      return evento;
    }

    const url = await generatePosterWithHour(evento);
    evento.poster = url;

    if (isCacheablePosterUrl(url)) {
      console.info(`[Poster] Agregando a updates: ${partidoNorm} → ${url}`);
      updates[partidoNorm] = url;
    } else {
      console.info(`[Poster] No se agrega a updates (URL no válida): ${partidoNorm} → ${url}`);
    }
    return evento;
  });

  console.info(`[Poster] Updates generados: ${JSON.stringify(updates)}`);
  const merged = { ...postersMap, ...updates };
  await kvWritePostersHoyMap(merged);

  return eventos;
}

async function scrapePosterForMatch({ partido, hora, deporte, competicion }) {
  const postersMap = await kvReadPostersHoyMap();
  const partidoNorm = normalizeMatchName(partido);
  const cached = postersMap[partidoNorm];
  if (isCacheablePosterUrl(cached)) {
    console.info(`[Poster] Recuperado desde postersBlobHoy para ${partidoNorm}: ${cached}`);
    return cached;
  }
  console.info(`[Poster] Generando poster bajo demanda para ${partidoNorm}`);
  return await generatePosterWithHour({ partido, hora, deporte, competicion });
}

module.exports = {
  scrapePosterForMatch,
  scrapePostersConcurrenciaLimitada,
  generatePlaceholdPoster
};
