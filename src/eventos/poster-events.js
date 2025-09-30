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
  return `https://dummyimage.com/300x450/000/fff&text=${encodeURIComponent(String(hora))}`;
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
              console.info(`[Poster] Coincidencia encontrada en ${url} → ${p.src}`);
              return p.src;
            }
          } else if (p.src?.startsWith('http')) {
            return p.src;
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[Poster] Fallo al buscar en ${url}: ${err.message}`);
  }
  return null;
}

async function kvReadPostersHoyMap() {
  const data = await kvGetJsonTTL('postersBlobHoy');
  return data && typeof data === 'object' ? data : {};
}

async function kvWritePostersHoyMap(mergedMap) {
  await kvSetJsonTTL('postersBlobHoy', mergedMap, 86400);
  console.info(`[Poster] KV actualizado con ${Object.keys(mergedMap).length} entradas`);
}

async function generatePosterWithHour({ partido, hora, deporte, competicion, dia }) {
  let posterSourceUrl;
  try {
    const sport = (deporte || '').toLowerCase();
    const isTenis = sport === 'tenis';
    const isBaloncesto = sport === 'baloncesto';
    const isFutbol = sport === 'futbol' || sport === 'fútbol';

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
      const isYouth = /youth|sub-21|juvenil/i.test(comp);
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

// ✅ Única función reutilizable
async function scrapePosterForMatch({ partido, hora, deporte, competicion, dia }, cacheMap = null) {
  const partidoNorm = normalizeMatchName(`${partido} ${hora} ${dia} ${competicion}`);
  const postersMap = cacheMap || await kvGetJsonTTL('postersBlobHoy') || {};

  if (typeof postersMap[partidoNorm] === 'string' && postersMap[partidoNorm].length > 0) {
    return postersMap[partidoNorm];
  }

  const url = await generatePosterWithHour({ partido, hora, deporte, competicion, dia });

  if (isCacheablePosterUrl(url)) {
    const updatedMap = { ...postersMap, [partidoNorm]: url };
    await kvSetJsonTTL('postersBlobHoy', updatedMap, 86400);
    return url;
  }

  return generatePlaceholdPoster({ hora });
}
// NUEVA FUNCIÓN para gestión en paralelo
function buildPosterKey(ev) {
  return normalizeMatchName(`${ev.partido} ${ev.hora} ${ev.dia} ${ev.competicion}`);
}

// ✅ Procesamiento en paralelo usando la misma función
async function scrapePostersForEventos(eventos) {
  const kvPayload = {};

  await Promise.all(
    eventos.map(async ev => {
      const posterUrl = await generatePosterWithHour(ev);
      const key = buildPosterKey(ev);
      if (isCacheablePosterUrl(posterUrl)) {
        kvPayload[key] = posterUrl;
      }
    })
  );

  await kvSetJsonTTL('postersBlobHoy', kvPayload);
  console.info(`[Poster] KV actualizado con ${Object.keys(kvPayload).length} entradas`);
}

// ✅ Procesamiento en lote usando la misma función
async function VIEJOscrapePostersForEventos(eventos) {
  const postersMap = await kvReadPostersHoyMap();
  const updates = {};
  const resultados = [];

  const eventosSinPoster = eventos.filter(ev => {
    const partidoNorm = normalizeMatchName(`${ev.partido} ${ev.hora} ${ev.dia} ${ev.competicion}`);
    return !isCacheablePosterUrl(postersMap[partidoNorm]);
  });

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

    const partidoNorm = normalizeMatchName(`${evento.partido} ${evento.hora} ${evento.dia} ${evento.competicion}`);
    if (isCacheablePosterUrl(url)) {
      updates[partidoNorm] = url;
    }

    evento.poster = url;
    resultados.push(evento);
  }

  if (Object.keys(updates).length > 0) {
    const merged = { ...postersMap, ...updates };
    await kvWritePostersHoyMap(merged);
  }

  const eventosConPosterPrevio = eventos.filter(ev => {
    const partidoNorm = normalizeMatchName(`${ev.partido} ${ev.hora} ${ev.dia} ${ev.competicion}`);
    return isCacheablePosterUrl(postersMap[partidoNorm]);
  }).map(ev => ({
    ...ev,
    poster: postersMap[normalizeMatchName(`${ev.partido} ${ev.hora} ${ev.dia} ${ev.competicion}`)]
  }));

  return [...eventosConPosterPrevio, ...resultados];
}

module.exports = {
  scrapePosterForMatch,
  scrapePostersForEventos,
  generatePlaceholdPoster
};
