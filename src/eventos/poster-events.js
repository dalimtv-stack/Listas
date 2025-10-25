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
    .replace(/[\u2013\u2014\u2212]/g, '-')   // en dash, em dash, minus → guion simple
    .replace(/\s+/g, ' ')
    .trim();
}

function generatePlaceholdPoster({ hora }) {
  return `https://dummyimage.com/300x450/000000/ffffff.png&text=${encodeURIComponent(String(hora))}`;
}

function isCacheablePosterUrl(url) {
  return typeof url === 'string' && !url.includes('dummyimage.com');
}

function generateFallbackNames(original, context = '') {
  const normalized = normalizeMatchName(original);
  const variants = [normalized];

  // Diccionario de alias en su forma "humana"
  const teamAliases = {
    'atletico de madrid': 'at. madrid',
    'real madrid': 'r. madrid',
    'fc barcelona': 'barça',
    'atlético madrileño': 'atlético de madrid b',
    'juventus': 'juve',
    'inter milan': 'inter',
    'ac milan': 'milan',
    'bayern munich': 'bayern',
    'borussia dortmund': 'dortmund',
    'paris saint-germain': 'psg',
    'simulcast': ['multieuropa', 'multichampions']
  };

  // Normalizamos las claves del diccionario para que coincidan con normalizeMatchName
  const normalizedAliases = {};
  for (const [full, alias] of Object.entries(teamAliases)) {
    normalizedAliases[normalizeMatchName(full)] = alias;
  }

  let aliasVersion = normalized;
  for (const [fullNorm, alias] of Object.entries(normalizedAliases)) {
    const regex = new RegExp(`\\b${fullNorm}\\b`, 'gi');
    if (Array.isArray(alias)) {
      alias.forEach(a => {
        const replaced = aliasVersion.replace(regex, normalizeMatchName(a));
        if (replaced !== aliasVersion) variants.push(replaced);
      });
    } else {
      const replaced = aliasVersion.replace(regex, normalizeMatchName(alias));
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
    //console.info(`[Poster] Buscando póster en ${url} para candidatos: ${candidates.join(', ')}`);
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
    
    // 👉 Aquí pegas los logs de depuración
    //console.log('CANDIDATES:', candidates.map(normalizeMatchName));
    //for (const p of posters) {
      //console.log('TITULO:', normalizeMatchName(p.titulo));
    //}

    for (const name of candidates) {
      const nameNorm = normalizeMatchName(name);
      const regex = new RegExp(`\\b${nameNorm}\\b`, 'i');

      for (const p of posters) {
        const tituloNorm = normalizeMatchName(p.titulo);
        if (regex.test(tituloNorm)) {
          if (eventoFecha && p.fecha) {
            const diff = Math.abs(p.fecha.diff(eventoFecha, 'minutes').minutes);
            if (diff <= 30 && p.src?.startsWith('http')) {
              //console.info(`[Poster] Coincidencia encontrada en ${url} → ${p.src} (fecha: ${p.fecha.toISO()})`);
              return p.src;
            }
          } else if (p.src?.startsWith('http')) {
            //console.info(`[Poster] Coincidencia encontrada en ${url} → ${p.src} (sin validación de fecha)`);
            return p.src;
          }
        }
      }
    }
    //console.info(`[Poster] No se encontró póster en ${url} para candidatos: ${candidates.join(', ')}`);
  } catch (err) {
    console.warn(`[Poster] Fallo al buscar en ${url}: ${err.message}`);
  }
  return null;
}

async function kvReadPostersHoyMap() {
  try {
    const data = await kvGetJsonTTL('postersBlobHoy');
    //console.info('[Poster] Valor crudo de kvGetJsonTTL:', JSON.stringify(data));
    if (!data || typeof data !== 'object') {
      console.info('[Poster] KV vacío o inválido, devolviendo datos por defecto');
      return { data: {}, timestamp: 0 };
    }
    // Manejar estructura { data: { ... }, timestamp: number } o { key: url, ... }
    const result = {
      data: data.data && typeof data.data === 'object' ? data.data : (Object.keys(data).length > 0 ? data : {}),
      timestamp: typeof data.timestamp === 'number' ? data.timestamp : 0
    };
    //console.info(`[Poster] KV leído: postersBlobHoy con ${Object.keys(result.data).length} entradas, timestamp: ${result.timestamp}`);
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
    //console.log('Competición:', competicion);
    //console.log('Deporte:', deporte);
    const sport = (deporte || '').toLowerCase();
    const isFutbol = sport === 'futbol' || sport === 'fútbol';
    const isTenis = sport === 'tenis';
    const isBaloncesto = sport === 'baloncesto';
    const isBalonmano = sport === 'balonmano';
    const isRugby = sport === 'rugby';
    const isCiclismo = sport === 'ciclismo';
    const isGolf = sport === 'golf'; 
    const isMotos = sport === 'motos';
    const isF1 = sport === 'fórmula 1';
    const isHockey = sport === 'hockey';
  try {
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
    } else if (isRugby) {
      fuentes = [
        'https://www.movistarplus.es/deportes/rugby?conf=iptv',
        'https://www.movistarplus.es/deportes?conf=iptv',
        'https://www.movistarplus.es/el-partido-movistarplus'
      ];
    } else if (isHockey) {
      fuentes = [
        'https://www.movistarplus.es/deportes?conf=iptv',
        'https://www.movistarplus.es/el-partido-movistarplus'
      ];
    } else if (isGolf) {
      fuentes = [
        'https://www.movistarplus.es/deportes/golf?conf=iptv',
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
    if (isBalonmano && competicion?.toLowerCase() === 'champions league') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/Balonmano_champions.jpeg';
    } else if (isBalonmano && competicion?.toLowerCase() === 'european league') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/Balonmano_liga_europea.jpeg';
    } else if (isBalonmano) {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/Balonmano.png';
    } else if (isFutbol && competicion?.toLowerCase() === 'liga f') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/c_crop,g_north,h_456,w_314/c_scale,h_600,w_405/plantillas/ligafemenina.jpg';
    } else if (isFutbol && competicion?.toLowerCase() === 'laliga ea sports') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/LaLigaEA.jpeg';
    } else if (isFutbol) {
      // posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/Futbol1.png';
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/futbol.jpeg';
    } else if (isRugby && competicion?.toLowerCase() === 'top 14') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/rugby-top14.jpeg';
    } else if (deporte.toLowerCase() && competicion.toLowerCase() === 'nhl') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/NHL.jpeg';
    } else if (deporte && deporte.toLowerCase() === 'ufc') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/UFC.jpeg';
    } else if (isF1) {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/Formula1.jpeg';
    } else if (isMotos && partido.toLowerCase() === 'motogp') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/Mundial_MotoGP.png';
    } else if (isMotos && partido.toLowerCase() === 'moto2') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/Mundial_Moto2.png';
    } else if (isMotos && partido.toLowerCase() === 'moto3') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/Mundial_Moto3.png';
    } else if (deporte && deporte.toLowerCase() === 'waterpolo') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/ar_0.675,c_fill,g_auto,w_405,q_auto,f_auto/plantillas/waterpolo.jpeg';
    } else if (deporte && deporte.toLowerCase() === 'baloncesto') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/baloncesto.jpeg';
    } else if (deporte && deporte.toLowerCase() === 'billar') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/billar.jpeg';
    } else if (deporte && deporte.toLowerCase() === 'f. sala') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/futbolsala.jpeg';
    } else if (deporte && deporte.toLowerCase() === 'tenis') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/tenis.jpeg';
    } else if (isCiclismo && competicion?.toLowerCase() === 'mundial en pista') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/Ciclismo_pista.jpeg';
    } else if (isCiclismo) {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/Ciclismo.jpeg';
    } else if (deporte && deporte.toLowerCase() === 'artística') {
      posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/G_Artistica.jpeg';
    } else {
      // posterSourceUrl = 'https://res.cloudinary.com/doimszxld/image/upload/plantillas/MultiChampions.jpeg'
      await registrarPosterError({ partido, hora, deporte, competicion, dia });
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
  const finalUrl = generado?.url;
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
    //console.info(`[Poster] Póster encontrado en KV para ${partidoNorm}: ${postersMap[partidoNorm]}`);
    return postersMap[partidoNorm];
  }

  const url = await generatePosterWithHour({ partido, hora, deporte, competicion, dia });

  if (isCacheablePosterUrl(url)) {
    const updatedMap = { ...postersMap, [partidoNorm]: url };
    await kvWritePostersHoyMap(updatedMap);
    //console.info(`[Poster] Póster cacheado para ${partidoNorm}: ${url}`);
  }

  return url;
}

async function scrapePostersForEventos(eventos) {
  //console.info(`[Poster] Iniciando procesamiento de ${eventos.length} eventos`);
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

async function registrarPosterError({ partido, hora, deporte, competicion, dia }) {
  const { kvGetJsonTTL, kvSetJsonTTL } = require('../../api/kv');
  const claveError = 'Error:poster';
  const nuevoError = { partido, hora, deporte, competicion, dia };

  try {
    const prev = await kvGetJsonTTL(claveError) || [];
    const yaExiste = prev.some(e =>
      e.partido === partido &&
      e.hora === hora &&
      e.deporte === deporte &&
      e.competicion === competicion &&
      e.dia === dia
    );

    if (!yaExiste) {
      await kvSetJsonTTL(claveError, [...prev, nuevoError], 7 * 86400);
      console.warn('[Poster] Registrado en Error:poster:', nuevoError);
    }
  } catch (err) {
    console.error('[Poster] Error al registrar en KV Error:poster:', err.message);
  }
}

module.exports = {
  scrapePosterForMatch,
  scrapePostersForEventos,
  generatePlaceholdPoster
};