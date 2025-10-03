// src/eventos/scraper-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { scrapePostersForEventos } = require('./poster-events');
const { DateTime } = require('luxon');
const { kvGetJsonTTL, kvSetJsonTTL } = require('../../api/kv');

function getDay(cache) {
  return cache?.data?.day ?? cache?.day ?? null;
}

function getEventos(cache) {
  const dataObj = cache?.data?.data ?? cache?.data ?? {};
  return Object.values(dataObj || {});
}

function buildEventKey(ev) {
  return [ev.partido, ev.hora, ev.dia, ev.competicion].filter(Boolean).join('|');
}

function parseFechaMarca(texto, añoPorDefecto) {
  const meses = {
    enero: '01', febrero: '02', marzo: '03', abril: '04',
    mayo: '05', junio: '06', julio: '07', agosto: '08',
    septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
  };

  const lower = (texto || '').toLowerCase().trim();

  // "30 de septiembre de 2025"
  const matchCompleto = lower.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/);
  if (matchCompleto) {
    const [_, dd, mes, yyyy] = matchCompleto;
    const mm = meses[mes];
    if (!mm) return '';
    return `${yyyy}-${mm}-${dd.padStart(2, '0')}`;
  }

  // "30 de septiembre"
  const matchSinAnio = lower.match(/(\d{1,2})\s+de\s+(\w+)/);
  if (matchSinAnio) {
    const [_, dd, mes] = matchSinAnio;
    const mm = meses[mes];
    if (!mm) return '';
    const yyyy = añoPorDefecto || new Date().getFullYear();
    return `${yyyy}-${mm}-${dd.padStart(2, '0')}`;
  }

  console.warn(`[EVENTOS] No se pudo parsear fecha: "${texto}" → "${lower}"`);
  return '';
}

function formatoFechaES(fecha) {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(fecha);
}

function eventoEsReciente(dia, hora) {
  try {
    const ahora = DateTime.now().setZone('Europe/Madrid');

    const eventoFecha = DateTime.fromFormat(String(dia || ''), 'dd/MM/yyyy', { zone: 'Europe/Madrid' });
    const [hh, min] = String(hora || '').split(':');
    const evento = eventoFecha.set({
      hour: parseInt(hh || '0', 10),
      minute: parseInt(min || '0', 10)
    });

    if (!evento.isValid) return false;

    const hoyISO = ahora.toISODate();
    const ayerISO = ahora.minus({ days: 1 }).toISODate();
    const mañanaISO = ahora.plus({ days: 1 }).toISODate();
    const eventoISODate = evento.toISODate();

    // HOY
    if (eventoISODate === hoyISO) {
      if (ahora.hour < 3) return true; // 00:00–02:59 → todo el día
      const umbralPasado3h = ahora.minus({ hours: 3 });
      return evento.toMillis() >= umbralPasado3h.toMillis();
    }

    // AYER → ≤ 2h en el pasado
    if (eventoISODate === ayerISO) {
      const umbralAyer2h = ahora.minus({ hours: 2 });
      return evento.toMillis() >= umbralAyer2h.toMillis();
    }

    // MAÑANA → desde las 22:00 y dentro de próximas 3h
    if (eventoISODate === mañanaISO) {
      if (ahora.hour < 22) return false;
      const umbralFuturo3h = ahora.plus({ hours: 3 });
      return evento.toMillis() >= ahora.toMillis() && evento.toMillis() <= umbralFuturo3h.toMillis();
    }

    return false;
  } catch (e) {
    console.warn('[EVENTOS] Error en eventoEsReciente', e);
    return false;
  }
}

async function fetchEventos(url) {
  const ahoraDT = DateTime.now().setZone('Europe/Madrid');
  const hoyStr = ahoraDT.toFormat('dd/MM/yyyy');
  const ayerStr = ahoraDT.minus({ days: 1 }).toFormat('dd/MM/yyyy');
  const mañanaStr = ahoraDT.plus({ days: 1 }).toFormat('dd/MM/yyyy');

  // 1. Leer caches
  const cacheHoy = await kvGetJsonTTL('EventosHoy');
  const cacheAyer = await kvGetJsonTTL('EventosAyer');
  const cacheMañana = await kvGetJsonTTL('EventosMañana');

  // 2. Si hay cache válido de hoy → devolver unión, filtrada por ventana temporal
  if (getDay(cacheHoy) === hoyStr) {
    console.info('[EVENTOS] Usando cache de EventosHoy (+Ayer,+Mañana)');
    const merged = [
      ...getEventos(cacheAyer),
      ...getEventos(cacheHoy),
      ...getEventos(cacheMañana)
    ].filter(ev => eventoEsReciente(ev.dia, ev.hora));
    return merged;
  }

  // 3. Promocionar caches si toca
  // Si el cacheHoy está desfasado (en realidad es de ayer), lo pasamos a Ayer
  if (getDay(cacheHoy) === ayerStr) {
    await kvSetJsonTTL('EventosAyer', {
      day: getDay(cacheHoy),
      data: (cacheHoy?.data?.data ?? cacheHoy?.data ?? {})
    }, 86400);
  }

  // Si el cacheMañana corresponde al nuevo día de hoy → lo promovemos
  if (getDay(cacheMañana) === hoyStr) {
    console.info('[EVENTOS] Promocionando EventosMañana a Hoy');

    // 1. Recuperar los eventos de mañana
    let eventosPromocionados = getEventos(cacheMañana);

    // 2. Volver a pedir posters para ellos
    eventosPromocionados = await scrapePostersForEventos(eventosPromocionados);

    // 3. Guardar como EventosHoy con posters frescos (claves robustas)
    const mapHoy = {};
    for (const ev of eventosPromocionados) {
      delete ev.genero; // 🔧 limpiar flag temporal
      mapHoy[buildEventKey(ev)] = ev;
    }
    await kvSetJsonTTL('EventosHoy', {
      day: getDay(cacheMañana),
      data: mapHoy
    }, 86400);

    // 4. Invalidar postersBlobHoy para forzar regeneración
    await kvSetJsonTTL('postersBlobHoy', { data: {}, timestamp: 0 }, 1);

    // 5. Devolver unión Ayer + Hoy, filtrada por ventana temporal
    const merged = [
      ...getEventos(cacheAyer),
      ...eventosPromocionados
    ].filter(ev => eventoEsReciente(ev.dia, ev.hora));

    return merged;
  }

  // 4. Si no hay cache válido, scrapear como antes
  let eventosConPoster = await scrapeEventosDesdeMarca(ahoraDT);

  // 5. Guardar en KV como objetos completos (sin anidar otra cabecera)
  const mapHoy = {}, mapMañana = {}, mapAyer = {};
  for (const ev of eventosConPoster) {
    const key = buildEventKey(ev);
    delete ev.genero
    if (ev.dia === hoyStr) mapHoy[key] = ev;
    else if (ev.dia === ayerStr) mapAyer[key] = ev;
    else if (ev.dia === mañanaStr) mapMañana[key] = ev;
  }

  if (Object.keys(mapHoy).length) {
    await kvSetJsonTTL('EventosHoy', { day: hoyStr, data: mapHoy }, 86400);
  }
  if (Object.keys(mapAyer).length) {
    await kvSetJsonTTL('EventosAyer', { day: ayerStr, data: mapAyer }, 86400);
  }
  if (Object.keys(mapMañana).length) {
    await kvSetJsonTTL('EventosMañana', { day: mañanaStr, data: mapMañana }, 86400);
  }

  return eventosConPoster;
}

async function scrapeEventosDesdeMarca(ahoraDT) {
  const eventos = [];
  const eventosUnicos = new Set();

  const hoyISO = ahoraDT.toISODate();
  const fechaFormateada = formatoFechaES(ahoraDT.toJSDate());

  console.info(`[EVENTOS] Fecha del sistema: ${fechaFormateada} (${hoyISO})`);

  try {
    const MARCA_URL = 'https://www.marca.com/programacion-tv.html';
    const res = await fetch(MARCA_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; scraper)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} en Marca`);
    const buffer = await res.buffer();
    const html = iconv.decode(buffer, 'latin1');
    const $ = cheerio.load(html);

    const bloques = $('ol.daylist > li.content-item, ol.auto-items.daylist > li.content-item')
      .filter((i, el) => $(el).find('.title-section-widget').length > 0);

    if (bloques.length === 0) {
      console.warn('[EVENTOS] No se encontraron bloques con fecha válida');
      return [crearFallback(hoyISO)];
    }

    console.info('[EVENTOS] Estructura detectada: daylist / dailyevent');

    bloques.each((_, li) => {
      const $li = $(li);

      const fechaTexto = $li
        .find('.title-section-widget')
        .clone()
        .children('strong')
        .remove()
        .end()
        .text()
        .trim();

      const fechaISO = parseFechaMarca(fechaTexto, ahoraDT.year);
      if (!fechaISO) {
        console.warn(`[EVENTOS] Fecha de bloque inválida: "${fechaTexto}"`);
        return;
      }

      const fechaBloque = DateTime.fromISO(fechaISO, { zone: 'Europe/Madrid' });
      const diffDias = fechaBloque.startOf('day').diff(ahoraDT.startOf('day'), 'days').days;

      if (diffDias < -1 || diffDias > 1) {
        console.info(`[EVENTOS] Bloque descartado (${fechaISO}), fuera de rango`);
        return;
      }

      console.info(`[EVENTOS] Bloque aceptado: ${fechaISO}`);

      const [yyyy, mm, dd] = fechaISO.split('-');
      const fechaFormateadaMarca = `${dd}/${mm}/${yyyy}`;

      const eventosLis = $li.children('ol').first().children('li.dailyevent');
      let eventosCuentaBloque = 0;

      eventosLis.each((_, eventoLi) => {
        const $ev = $(eventoLi);

        const pertenece = $ev.closest('li.content-item')[0] === li;
        if (!pertenece) return;

        const hora = $ev.find('.dailyhour').text().trim() || '';
        const deporte = $ev.find('.dailyday').text().trim() || '';
        const competicion = $ev.find('.dailycompetition').text().trim() || '';
        const partido = $ev.find('.dailyteams').text().trim() || '';
        const canal = $ev.find('.dailychannel').text().trim() || '';

        const eventoId = `${fechaISO}|${hora}|${partido}|${competicion}`;
        if (eventosUnicos.has(eventoId)) return;
        eventosUnicos.add(eventoId);

        const esReciente = eventoEsReciente(fechaFormateadaMarca, hora);
        const esMañana = diffDias === 1;

        if (!esReciente && !esMañana) return;

        const evento = {
          dia: fechaFormateadaMarca,
          hora,
          deporte,
          competicion,
          partido,
          canales: [{ label: canal, url: null }]
        };

        if (esMañana && !esReciente) {
          evento.genero = 'Mañana';
        }

        eventos.push(evento);
        eventosCuentaBloque++;
      });

      console.info(`[EVENTOS] Eventos aceptados en bloque ${fechaISO}: ${eventosCuentaBloque}`);
    });

    console.info(`[EVENTOS] Scrapeo finalizado desde Marca: ${eventos.length} eventos`);
  } catch (err) {
    console.warn(`[EVENTOS] Fallo al scrapear Marca: ${err.message}`);
  }

  if (eventos.length === 0) {
    console.warn(`[EVENTOS] No se encontraron eventos para hoy (${hoyISO})`);
    return [crearFallback(hoyISO)];
  }

  // Ordenar cronológicamente ANTES de pedir posters
  eventos.forEach(ev => {
    let [dd, mm, yyyy] = ev.dia.split('/');
    let [hh, min] = (ev.hora || '').split(':');
    dd = dd || '01'; mm = mm || '01'; yyyy = yyyy || new Date().getFullYear();
    hh = hh && /^\d+$/.test(hh) ? hh.padStart(2, '0') : '99';
    min = min && /^\d+$/.test(min) ? min.padStart(2, '0') : '99';
    ev._orden = DateTime.fromISO(`${yyyy}-${mm}-${dd}T${hh}:${min}`, { zone: 'Europe/Madrid' });
  });

  eventos.sort((a, b) => a._orden.toMillis() - b._orden.toMillis());
  eventos.forEach(ev => delete ev._orden);

  // Pasar a posters
  let eventosConPoster = await scrapePostersForEventos(eventos);

  // ⚠️ Reordenar otra vez por si scrapePostersForEventos desordena
  eventosConPoster.forEach(ev => {
    let [dd, mm, yyyy] = ev.dia.split('/');
    let [hh, min] = (ev.hora || '').split(':');
    dd = dd || '01'; mm = mm || '01'; yyyy = yyyy || new Date().getFullYear();
    hh = hh && /^\d+$/.test(hh) ? hh.padStart(2, '0') : '99';
    min = min && /^\d+$/.test(min) ? min.padStart(2, '0') : '99';
    ev._orden = DateTime.fromISO(`${yyyy}-${mm}-${dd}T${hh}:${min}`, { zone: 'Europe/Madrid' });
  });

  eventosConPoster.sort((a, b) => a._orden.toMillis() - b._orden.toMillis());
  eventosConPoster.forEach(ev => delete ev._orden);

  return eventosConPoster;
}

function crearFallback(hoyISO) {
  const dia = `${hoyISO.slice(8, 10)}/${hoyISO.slice(5, 7)}/${hoyISO.slice(0, 4)}`;
  const texto = 'No hay eventos disponibles hoy';
  return {
    dia,
    hora: '',
    deporte: '',
    competicion: texto,
    partido: texto,
    canales: [],
    poster: `https://dummyimage.com/300x450/000000/ffffff.png&text=${encodeURIComponent(texto)}`
  };
}

module.exports = { fetchEventos };
