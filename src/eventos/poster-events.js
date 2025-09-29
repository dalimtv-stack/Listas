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

function isBlobPosterUrl(url) {
  if (typeof url !== 'string') return false;
  const startsOk = url.startsWith('https://') && url.includes('.public.blob.vercel-storage.com/posters/');
  const endsOk = url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg');
  return startsOk && endsOk;
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

function generatePlaceholdPoster({ hora }) {
  return `https://dummyimage.com/300x450/000/fff&text=${encodeURIComponent(hora)}`;
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

async function scrapePosterForMatch({ partido, hora, deporte, competicion }) {
  const partidoNorm = normalizeMatchName(partido);

  // 1) KV global del día
  const postersHoy = (await kvGetJson('postersBlobHoy')) || {};
  const yaGenerado = postersHoy[partidoNorm];
  if (isBlobPosterUrl(yaGenerado)) {
    console.info(`[Poster] Recuperado desde postersBlobHoy (sin regenerar): ${partidoNorm}`);
    return yaGenerado;
  }

  // 2) Scraping de fuente original (solo si no existe en KV)
  let posterUrl;
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
      posterUrl = await buscarPosterEnFuente(fuente, candidates);
      if (posterUrl) break;
    }

    // Cache auxiliar del scrapeo (opcional y no crítico)
    if (posterUrl?.startsWith('http')) {
      const movistarCacheKey = `poster:${partidoNorm}`;
      await kvSetJsonTTLIfChanged(movistarCacheKey, { posterUrl, createdAt: Date.now() }, 86400);
    }
  } catch (err) {
    console.error('[Poster] Error scraping:', err.message);
  }

  // 3) Si no se encontró, usar fallback
  if (!posterUrl?.startsWith('http')) {
    console.warn('[Poster] No se encontró póster válido, devolviendo fallback (no se cachea)');
    return generatePlaceholdPoster({ hora });
  }

  // 4) Generación con hora (API interna)
  const endpoint = `https://listas-sand.vercel.app/poster-con-hora?url=${encodeURIComponent(posterUrl)}`;
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

  // 5) Guardar en KV solo si es URL válida y diferente a la existente
  if (isBlobPosterUrl(finalUrl) && finalUrl !== yaGenerado) {
    const actualizado = { ...postersHoy, [partidoNorm]: finalUrl };
    await kvSetJsonTTLIfChanged('postersBlobHoy', actualizado, 86400);
    console.info(`[Poster] Guardado en postersBlobHoy: ${partidoNorm} → ${finalUrl}`);
    return finalUrl;
  }

  // 6) Si es el mismo que ya estaba, devolvemos directamente
  if (isBlobPosterUrl(finalUrl)) {
    return finalUrl;
  }

  // 7) Si no es válido, fallback
  return generatePlaceholdPoster({ hora });
}

async function scrapePostersConcurrenciaLimitada(eventos, limite = 4) {
  const resultados = [];
  const cola = [...eventos];
  const activos = [];

  while (cola.length > 0 || activos.length > 0) {
    while (activos.length < limite && cola.length > 0) {
      const evento = cola.shift();
      const promesa = scrapePosterForMatch(evento).then(url => {
        evento.poster = url;
        resultados.push(evento);
      });
      activos.push(promesa);
    }
    await Promise.race(activos);
    activos.splice(0, activos.length, ...activos.filter(p => !p.isFulfilled));
  }

  return resultados;
}

module.exports = {
  scrapePosterForMatch,
  scrapePostersConcurrenciaLimitada,
  generatePlaceholdPoster
};
