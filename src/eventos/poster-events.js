// src/eventos/poster-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJson, kvSetJsonTTLIfChanged } = require('../../api/kv');

function normalizeMatchName(matchName) {
  return String(matchName || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generatePlaceholdPoster({ hora }) {
  return 'https://dummyimage.com/300x450/000/fff&text=' + encodeURIComponent(String(hora || ''));
}

// Solo cacheamos si no es el placeholder y parece una imagen final en formato PNG
function isCacheablePosterUrl(url) {
  return typeof url === 'string'
    && url.length > 0
    && url.indexOf('dummyimage.com') === -1
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
  for (const entry of Object.entries(teamAliases)) {
    const full = entry[0];
    const alias = entry[1];
    const regex = new RegExp('\\b' + full + '\\b', 'gi');
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

  return Array.from(new Set(variants));
}

async function buscarPosterEnFuente(url, candidates) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const $ = cheerio.load(html);

    for (let i = 0; i < candidates.length; i++) {
      const name = candidates[i];
      const nameRegex = new RegExp(name.replace(/[-]/g, '[ -]'), 'i');
      let encontrado = null;

      $('img').each(function () {
        const altRaw = $(this).attr('alt') || '';
        let alt = '';
        try { alt = String(altRaw).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { alt = String(altRaw).toLowerCase(); }

        const srcRaw = $(this).attr('src') || '';
        const src = String(srcRaw).toLowerCase();

        if (nameRegex.test(alt) || nameRegex.test(src)) {
          encontrado = $(this).attr('src');
          return false; // break each
        }
        return;
      });

      if (encontrado && String(encontrado).indexOf('http') === 0) {
        console.info('[Poster] Coincidencia encontrada en ' + url + ' → ' + encontrado);
        return encontrado;
      }
    }
  } catch (err) {
    console.warn('[Poster] Fallo al buscar en ' + url + ': ' + (err && err.message ? err.message : err));
  }
  return null;
}

function normalizeBlobUrl(url) {
  if (!url) return null;
  try {
    if (String(url).indexOf('http') === 0) return url;
    // Si viene como "posters/xxx.png" o "/posters/xxx.png", anteponer host del bucket
    return 'https://kb24ncicobqdaseh.public.blob.vercel-storage.com/' + String(url).replace(/^\/+/, '');
  } catch (e) {
    return null;
  }
}

// --- KV helpers ---

async function kvReadPostersHoyMap() {
  try {
    const wrapper = await kvGetJson('postersBlobHoy'); // wrapper { timestamp, ttlMs, data }
    const rawMap = wrapper && typeof wrapper === 'object' && wrapper.data ? wrapper.data : {};
    // Normalizamos las URLs almacenadas para devolver siempre una URL absoluta si procede
    const normalized = {};
    for (const k of Object.keys(rawMap)) {
      normalized[k] = normalizeBlobUrl(rawMap[k]) || rawMap[k];
    }
    return normalized;
  } catch (e) {
    console.error('[Poster] Error leyendo postersBlobHoy desde KV:', e && e.message ? e.message : e);
    return {};
  }
}

async function kvWritePostersHoyMap(mergedMap) {
  try {
    // mergedMap se asume con URLs absolutas o relativas; kvSetJsonTTLIfChanged aplicará el envoltorio TTL
    await kvSetJsonTTLIfChanged('postersBlobHoy', mergedMap, 86400);
    console.info('[Poster] KV actualizado con ' + Object.keys(mergedMap).length + ' entradas');
  } catch (e) {
    console.error('[Poster] Error escribiendo postersBlobHoy en KV:', e && e.message ? e.message : e);
  }
}

// --- Generación de un póster con hora (sin escribir en KV aquí) ---

async function generatePosterWithHour({ partido, hora, deporte, competicion }) {
  let posterSourceUrl = null;
  try {
    const isTenis = deporte && String(deporte).toLowerCase() === 'tenis';
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

    for (let i = 0; i < fuentes.length; i++) {
      const fuente = fuentes[i];
      const found = await buscarPosterEnFuente(fuente, candidates);
      if (found) {
        posterSourceUrl = found;
        break;
      }
    }
  } catch (err) {
    console.error('[Poster] Error scraping:', err && err.message ? err.message : err);
  }

  if (!posterSourceUrl || String(posterSourceUrl).indexOf('http') !== 0) {
    return generatePlaceholdPoster({ hora });
  }

  const endpoint = 'https://listas-sand.vercel.app/poster-con-hora?url=' + encodeURIComponent(posterSourceUrl);
  let generados;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horas: [hora] })
    });
    generados = await res.json();
  } catch (err) {
    console.error('[Poster] Error al generar con hora:', err && err.message ? err.message : err);
    return generatePlaceholdPoster({ hora });
  }

  if (!Array.isArray(generados)) {
    console.error('[Poster] Respuesta inválida de poster-con-hora:', generados);
    return generatePlaceholdPoster({ hora });
  }

  const generado = generados.find(function (p) { return p && p.hora === hora; });
  const finalUrlRaw = generado && generado.url ? generado.url : null;
  const finalUrl = normalizeBlobUrl(finalUrlRaw);

  return isCacheablePosterUrl(finalUrl) ? finalUrl : generatePlaceholdPoster({ hora });
}

// --- Concurrencia simple por lotes ---

async function processInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const res = await Promise.all(batch.map(fn));
    results.push.apply(results, res);
  }
  return results;
}

// --- Orquestación ---

async function scrapePostersConcurrenciaLimitada(eventos, limite) {
  limite = limite || 4;
  const postersMap = await kvReadPostersHoyMap(); // mapa partidoNorm -> url (normalizado si procede)
  const updates = {};

  // procesamos en lotes para no saturar la API de generación
  await processInBatches(eventos, limite, async function (evento) {
    const partidoNorm = normalizeMatchName(evento.partido);
    const cachedRaw = postersMap[partidoNorm];

    // si existe en KV, usamos esa URL (normalizada)
    if (typeof cachedRaw === 'string' && cachedRaw.length > 0) {
      const cached = normalizeBlobUrl(cachedRaw) || cachedRaw;
      evento.poster = cached;
      return evento;
    }

    // no había en KV → generamos
    const url = await generatePosterWithHour(evento);
    evento.poster = url;

    // solo añadimos a updates si es una URL válida para cachear (no placeholder)
    if (isCacheablePosterUrl(url)) {
      updates[partidoNorm] = url;
    }
    return evento;
  });

  // si hay nuevas entradas válidas, las escribimos en KV (fusionando con lo existente)
  const keys = Object.keys(updates);
  if (keys.length > 0) {
    const merged = Object.assign({}, postersMap, updates);
    await kvWritePostersHoyMap(merged);
  } else {
    console.info('[Poster] KV sin cambios (no hay nuevas entradas válidas)');
  }

  return eventos;
}

async function scrapePosterForMatch({ partido, hora, deporte, competicion }) {
  const postersMap = await kvReadPostersHoyMap();
  const partidoNorm = normalizeMatchName(partido);
  const cachedRaw = postersMap[partidoNorm];
  if (typeof cachedRaw === 'string' && cachedRaw.length > 0) {
    return normalizeBlobUrl(cachedRaw) || cachedRaw;
  }
  return await generatePosterWithHour({ partido, hora, deporte, competicion });
}

module.exports = {
  scrapePosterForMatch,
  scrapePostersConcurrenciaLimitada,
  generatePlaceholdPoster
};
