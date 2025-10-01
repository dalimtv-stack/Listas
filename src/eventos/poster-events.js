// src/eventos/poster-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJsonTTL, kvSetJsonTTL } = require('../../api/kv');
const { DateTime } = require('luxon');

function normalizeMatchName(matchName) {
  return String(matchName)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generatePlaceholdPoster({ hora }) {
  return `https://dummyimage.com/300x450/000000/ffffff.png&text=${encodeURIComponent(String(hora))}`;
}

function isCacheablePosterUrl(url) {
  return typeof url === 'string'
    && url.toLowerCase().endsWith('.png')
    && !url.includes('dummyimage.com');
}

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

function parseFechaMovistar(texto, ahoraDT = DateTime.now().setZone('Europe/Madrid')) {
  if (!texto) return null;
  texto = texto.trim().toLowerCase();

  let base;
  if (texto.startsWith('hoy')) {
    base = ahoraDT.startOf('day');
    texto = texto.replace('hoy -', '').trim();
  } else if (texto.startsWith('mañana')) {
    base = ahoraDT.plus({ days: 1 }).startOf('day');
    texto = texto.replace('mañana -', '').trim();
  } else {
    const m = texto.match(/(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2}):(\d{2})h/);
    if (m) {
      const [_, dd, mm, hh, min] = m;
      return DateTime.fromObject(
        { year: ahoraDT.year, month: parseInt(mm), day: parseInt(dd), hour: parseInt(hh), minute: parseInt(min) },
        { zone: 'Europe/Madrid' }
      );
    }
  }

  const m2 = texto.match(/(\d{1,2}):(\d{2})h/);
  if (base && m2) {
    const [_, hh, min] = m2;
    return base.set({ hour: parseInt(hh), minute: parseInt(min) });
  }

  return null;
}

async function buscarPosterEnFuente(url, candidates, eventoFecha = null) {
  try {
    console.info(`[Poster] Buscando póster en ${url} para candidatos: ${candidates.join(', ')}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const posters = [];
    $('.mplus-collection__content li').each((_, li) => {
      const $li = $(li);
      const img = $li.find('.mplus-collection__image img');
      const src = img.attr('src');
      const fechaTexto = $li.find('.mplus-collection__date').text();
      const fecha = parseFechaMovistar(fechaTexto);

      const tituloSeo = $li.find('.mplus-collection__title-seo').text().trim();
      if (!tituloSeo || !src) return;

      posters.push({ titulo: tituloSeo, src, fecha });
    });

    for (const name of candidates) {
      const nameNorm = normalizeMatchName(name);
      const regex = new RegExp(`\\b${nameNorm}\\b`, 'i');

      for (const p of posters) {
        const tituloNorm = normalizeMatchName(p.titulo);
        if (regex.test(tituloNorm)) {
          if (eventoFecha && p.fecha) {
            const diff = Math.abs(p.fecha.diff(eventoFecha, 'minutes').minutes);
            if (diff <= 10 && p.src?.startsWith('http')) {
              console.info(`[Poster] Coincidencia encontrada en ${url} → ${p.src} (fecha: ${p.fecha.toISO()})`);
              return p.src;
            }
          } else if (p.src?.startsWith('http')) {
            console.info(`[Poster] Coincidencia encontrada en ${url} → ${p.src} (sin validación de fecha)`);
            return p.src;
          }
        }
      }
    }
    console.info(`[Poster] No se encontró póster en ${url} para candidatos: ${candidates.join(', ')}`);
  } catch (err) {
    console.warn(`[Poster] Fallo al buscar en ${url}: ${err.message}`);
  }
  return null;
}

async function kvReadPostersHoyMap() {
  try {
    const data = await kvGetJsonTTL('postersBlobHoy');
    console.info('[Poster] Valor crudo de kvGetJsonTTL:', JSON.stringify(data));
    if (!data || typeof data !== 'object') {
      console.info('[Poster] KV vacío o inválido, devolviendo datos por defecto');
      return { data: {}, timestamp: 0 };
    }
    // Manejar estructura { data: { ... }, timestamp: number } o { key: url, ... }
    const result = {
      data: data.data && typeof data.data === 'object' ? data.data : (Object.keys(data).length > 0 ? data : {}),
      timestamp: typeof data.timestamp === 'number' ? data.timestamp : 0
    };
    console.info(`[Poster] KV leído: postersBlobHoy con ${Object.keys(result.data).length} entradas, timestamp: ${result.timestamp}`);
    return result;
  } catch (err) {
    console.error('[Poster] Error al leer KV postersBlobHoy:', err.message);
    return { data: {}, timestamp: 0 };
  }
}

async function kvWritePostersHoyMap(mergedMap) {
  try {
    console.info(`[Poster] Intentando escribir en KV: ${Object.keys(mergedMap).length} entradas`, JSON.stringify(Object.keys(mergedMap)));
    const dataToWrite = { data: mergedMap, timestamp: DateTime.now().setZone('Europe/Madrid').toMillis() };
    await kvSetJsonTTL('postersBlobHoy', dataToWrite, 86400);
    console.info(`[Poster] KV actualizado con ${Object.keys(mergedMap).length} entradas`);
  } catch (err) {
    console.error('[Poster] Error al escribir en KV postersBlobHoy:', err.message);
    throw err;
  }
}

async function generatePosterWithHour({ partido, hora, deporte, competicion, dia }) {
  let posterSourceUrl;
    const sport = (deporte || '').toLowerCase();
    const isFutbol = sport === 'futbol' || sport === 'fútbol';
  try {
    const isTenis = sport === 'tenis';
    const isBaloncesto = sport === 'baloncesto';
    const isBalonmano = sport === 'balonmano';
    const isCiclismo = sport === 'ciclismo';

    const candidates = generateFallbackNames(partido, competicion);

    // Selección de fuentes según deporte
    let fuentes;
    if (isTenis) {
      fuentes = [
        'https://www.movistarplus.es/deportes/tenis/donde-ver',
        'https://www.movistarplus.es/deportes?conf=iptv',
        'https://www.movistarplus.es/el-partido-movistarplus'
      ];
    } else if (isBaloncesto) {
      fuentes = [
        'https://www.movistarplus.es/deportes/baloncesto?conf=iptv',
        'https://www.movistarplus.es/deportes?conf=iptv',
        'https://www.movistarplus.es/el-partido-movistarplus'
      ];
    } else if (isFutbol) {
      const comp = (competicion || '').toLowerCase();
      const isYouth = /youth|sub-21|sub-20|sub-19|juvenil/i.test(comp);
      fuentes = isYouth
        ? [
            'https://www.movistarplus.es/deportes?conf=iptv',
            'https://www.movistarplus.es/el-partido-movistarplus'
          ]
        : [
            'https://www.movistarplus.es/el-partido-movistarplus',
            'https://www.movistarplus.es/deportes?conf=iptv'
          ];
    } else {
      fuentes = [
        'https://www.movistarplus.es/deportes?conf=iptv',
        'https://www.movistarplus.es/el-partido-movistarplus'
      ];
    }

    // Construir DateTime del evento para comparar con Movistar
    let eventoFecha = null;
    if (dia && hora) {
      eventoFecha = DateTime.fromFormat(`${dia} ${hora}`, 'dd/MM/yyyy HH:mm', { zone: 'Europe/Madrid' });
    }

    for (const fuente of fuentes) {
      posterSourceUrl = await buscarPosterEnFuente(fuente, candidates, eventoFecha);
      if (posterSourceUrl) break;
    }
  } catch (err) {
    console.error('[Poster] Error scraping:', err.message);
  }

  if (!posterSourceUrl?.startsWith('http')) {
    if (deporte && deporte.toLowerCase() === 'balonmano') {
      posterSourceUrl = 'https://i.ibb.co/pvwRMBWB/Balonmano.png';
    } else if (isFutbol) {
      posterSourceUrl = 'https://i.ibb.co/dswZph87/Futbol1.png';
    } else if (deporte && deporte.toLowerCase() === 'ciclismo') {
      posterSourceUrl = 'https://i.ibb.co/CswnHc5p/IMG-2324.webp';
    } else {
      return generatePlaceholdPoster({ hora });
    }
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

function buildPosterKey({ partido, hora, dia, competicion }) {
  const parts = [partido, hora, dia, competicion].filter(part => part != null && part !== '');
  if (parts.length === 0) {
    console.warn('[Poster] No se pudo generar clave de póster: todos los campos son inválidos');
    return normalizeMatchName(`${partido || 'unknown'} ${hora || '00:00'}`);
  }
  return normalizeMatchName(parts.join(' '));
}

async function scrapePosterForMatch({ partido, hora, deporte, competicion, dia }, cacheMap = null) {
  const partidoNorm = buildPosterKey({ partido, hora, dia, competicion });
  const postersMap = cacheMap || (await kvGetJsonTTL('postersBlobHoy')) || {};

  if (typeof postersMap[partidoNorm] === 'string' && postersMap[partidoNorm].length > 0) {
    console.info(`[Poster] Póster encontrado en KV para ${partidoNorm}: ${postersMap[partidoNorm]}`);
    return postersMap[partidoNorm];
  }

  const url = await generatePosterWithHour({ partido, hora, deporte, competicion, dia });

  if (isCacheablePosterUrl(url)) {
    const updatedMap = { ...postersMap, [partidoNorm]: url };
    await kvWritePostersHoyMap(updatedMap);
    console.info(`[Poster] Póster cacheado para ${partidoNorm}: ${url}`);
  }

  return url;
}

async function scrapePostersForEventos(eventos) {
  console.info(`[Poster] Iniciando procesamiento de ${eventos.length} eventos`);
  let postersMap = await kvReadPostersHoyMap();

  // Verificar si postersBlobHoy es de antes de las 6:00 AM del día actual
  const now = DateTime.now().setZone('Europe/Madrid');
  const today6AM = now.startOf('day').set({ hour: 6, minute: 0 });
  const kvTimestamp = postersMap.timestamp ? DateTime.fromMillis(postersMap.timestamp, { zone: 'Europe/Madrid' }) : null;

  if (!kvTimestamp || kvTimestamp < today6AM) {
    console.info(`[Poster] postersBlobHoy obsoleto (timestamp: ${kvTimestamp?.toISO() || 'ninguno'}, today6AM: ${today6AM.toISO()}). Limpiando y regenerando.`);
    postersMap = { data: {}, timestamp: now.toMillis() };
    await kvWritePostersHoyMap(postersMap.data); // Limpiar KV
  } else {
    console.info(`[Poster] postersBlobHoy actual (timestamp: ${kvTimestamp.toISO()})`);
  }

  const updates = {};
  const resultados = [];

  const eventosSinPoster = eventos.filter(ev => {
    const partidoNorm = buildPosterKey(ev);
    return !isCacheablePosterUrl(postersMap.data[partidoNorm]);
  });

  console.info(`[Poster] Procesando ${eventosSinPoster.length} eventos sin póster cacheado`);

  for (const evento of eventosSinPoster) {
    const posterLabel = `Poster ${evento.partido}`;
    console.time(posterLabel);
    const url = await generatePosterWithHour({
      partido: evento.partido,
      hora: evento.hora,
      deporte: evento.deporte,
      competicion: evento.competicion,
      dia: evento.dia
    });
    console.timeEnd(posterLabel);

    const partidoNorm = buildPosterKey(evento);
    if (isCacheablePosterUrl(url)) {
      updates[partidoNorm] = url;
    }

    evento.poster = url;
    resultados.push(evento);
  }

  if (Object.keys(updates).length > 0) {
    const merged = { ...postersMap.data, ...updates };
    await kvWritePostersHoyMap(merged);
  }

  const eventosConPosterPrevio = eventos.filter(ev => {
    const partidoNorm = buildPosterKey(ev);
    return isCacheablePosterUrl(postersMap.data[partidoNorm]);
  }).map(ev => ({
    ...ev,
    poster: postersMap.data[buildPosterKey(ev)]
  }));

  const finalResultados = [...eventosConPosterPrevio, ...resultados];
  console.info(`[Poster] Procesamiento completado, ${finalResultados.length} eventos con pósters`);
  return finalResultados;
}

module.exports = {
  scrapePosterForMatch,
  scrapePostersForEventos,
  generatePlaceholdPoster
};
