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

// Acepta URLs tipo:
// https://<store>.public.blob.vercel-storage.com/posters/<id>_<HH_MM>.png
function isBlobPosterUrl(url) {
  if (typeof url !== 'string') return false;
  return /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/posters\/[a-z0-9]+_[0-9]{2}_[0-9]{2}\.png$/i.test(url);
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

// Lee el wrapper y devuelve el mapa plano de posters
async function kvReadPostersHoyMap() {
  const wrapper = await kvGetJson('postersBlobHoy');
  if (wrapper && typeof wrapper === 'object' && wrapper.data && typeof wrapper.data === 'object') {
    return wrapper.data;
  }
  return {};
}

// Escribe el mapa plano fusionado en la clave (kvSetJsonTTLIfChanged envuelve correctamente)
async function kvWritePostersHoyMap(mergedMap) {
  await kvSetJsonTTLIfChanged('postersBlobHoy', mergedMap, 86400);
}

// --- Generación por partido (sin escribir KV aquí) ---

async function generatePosterWithHour({ partido, hora, deporte, competicion }) {
  // Scrape fuente
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
    console.warn('[Poster] No se encontró póster en fuente, devolviendo fallback (no se cachea)');
    return generatePlaceholdPoster({ hora });
  }

  // Generar con hora
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
    console.error('[Poster] Respuesta inválida de poster-con-hora:', generados);
    return generatePlaceholdPoster({ hora });
  }

  const generado = generados.find(p => p.hora === hora);
  const finalUrl = generado?.url;

  if (isBlobPosterUrl(finalUrl)) {
    return finalUrl;
  }

  console.warn('[Poster] URL generada no válida o fallback; devolviendo fallback sin cachear');
  return generatePlaceholdPoster({ hora });
}

// --- Orquestación con KV: entrada usa KV, salida fusiona y escribe UNA vez ---

async function scrapePostersConcurrenciaLimitada(eventos, limite = 4) {
  // 1) Leer KV al inicio (mapa plano)
  const postersMap = await kvReadPostersHoyMap();
  const updates = {}; // nuevos que agregaremos al finalizar (solo Blob válidos)
  const resultados = [];

  // 2) Procesar eventos con límite de concurrencia
  const cola = [...eventos];
  const activos = [];

  async function procesar(evento) {
    const partidoNorm = normalizeMatchName(evento.partido);
    const cached = postersMap[partidoNorm];

    if (isBlobPosterUrl(cached)) {
      console.info(`[Poster] Usando KV existente: ${partidoNorm}`);
      evento.poster = cached;
      resultados.push(evento);
      return;
    }

    const url = await generatePosterWithHour(evento);
    evento.poster = url;
    resultados.push(evento);

    // Agregar a updates solo Blob válido (nunca fallback)
    if (isBlobPosterUrl(url)) {
      updates[partidoNorm] = url;
    }
  }

  while (cola.length > 0 || activos.length > 0) {
    while (activos.length < limite && cola.length > 0) {
      const evento = cola.shift();
      const p = procesar(evento).catch(err => {
        console.error('[Poster] Error procesando evento:', err?.message || err);
        // En caso de error, fallback sin cachear
        evento.poster = generatePlaceholdPoster({ hora: evento.hora });
        resultados.push(evento);
      });
      activos.push(p);
    }
    await Promise.race(activos);
    // Limpiar promesas cumplidas
    activos.splice(0, activos.length, ...activos.filter(pr => typeof pr.then === 'function'));
  }

  // 3) Al final, fusionar y escribir UNA vez en KV (solo nuevos)
  if (Object.keys(updates).length > 0) {
    const merged = { ...postersMap, ...updates };
    await kvWritePostersHoyMap(merged);
    console.info(`[Poster] KV actualizado: postersBlobHoy (${Object.keys(merged).length} entradas)`);
  } else {
    console.info('[Poster] KV sin cambios (no hay nuevas entradas válidas)');
  }

  return resultados;
}

// También mantenemos la función individual por compatibilidad, pero SIN escritura a KV
async function scrapePosterForMatch({ partido, hora, deporte, competicion }) {
  // Leer KV por si ya existe
  const postersMap = await kvReadPostersHoyMap();
  const partidoNorm = normalizeMatchName(partido);
  const cached = postersMap[partidoNorm];

  if (isBlobPosterUrl(cached)) {
    console.info(`[Poster] Recuperado desde postersBlobHoy: ${partidoNorm}`);
    return cached;
  }

  // Generar bajo demanda (sin escribir KV aquí; la escritura la hace la función de orquestación)
  const url = await generatePosterWithHour({ partido, hora, deporte, competicion });
  return url;
}

module.exports = {
  scrapePosterForMatch,
  scrapePostersConcurrenciaLimitada,
  generatePlaceholdPoster
};
