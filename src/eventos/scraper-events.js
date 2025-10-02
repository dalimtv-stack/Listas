// src/eventos/scraper-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { scrapePostersForEventos } = require('./poster-events');
const { kvGetJsonTTL, kvSetJsonTTLIfChanged } = require('../../api/kv');
const { DateTime } = require('luxon');

function parseFechaMarca(texto, añoPorDefecto) {
  const meses = {
    enero: '01', febrero: '02', marzo: '03', abril: '04',
    mayo: '05', junio: '06', julio: '07', agosto: '08',
    septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
  };

  const lower = (texto || '').toLowerCase().trim();
  const matchCompleto = lower.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/);
  if (matchCompleto) {
    const [_, dd, mes, yyyy] = matchCompleto;
    const mm = meses[mes];
    if (!mm) return '';
    return `${yyyy}-${mm}-${dd.padStart(2, '0')}`;
  }

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

function isValidKVDay(kvDay, targetDay) {
  try {
    const kvDate = DateTime.fromFormat(String(kvDay || ''), 'dd/MM/yyyy', { zone: 'Europe/Madrid' });
    const targetDate = DateTime.fromFormat(String(targetDay || ''), 'dd/MM/yyyy', { zone: 'Europe/Madrid' });
    return kvDate.isValid && targetDate.isValid && kvDate.toISODate() === targetDate.toISODate();
  } catch (err) {
    console.warn(`[EVENTOS] Error en isValidKVDay: ${err.message}`);
    return false;
  }
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

    if (eventoISODate === hoyISO) {
      if (ahora.hour < 3) return true;
      const umbralPasado3h = ahora.minus({ hours: 3 });
      return evento.toMillis() >= umbralPasado3h.toMillis();
    }

    if (eventoISODate === ayerISO) {
      const umbralAyer2h = ahora.minus({ hours: 2 });
      return evento.toMillis() >= umbralAyer2h.toMillis();
    }

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
  const hoyISO = ahoraDT.toISODate();
  const hoyDay = ahoraDT.toFormat('dd/MM/yyyy');
  const ayerDay = ahoraDT.minus({ days: 1 }).toFormat('dd/MM/yyyy');
  const mañanaDay = ahoraDT.plus({ days: 1 }).toFormat('dd/MM/yyyy');
  const fechaFormateada = formatoFechaES(ahoraDT.toJSDate());
  console.info(`[EVENTOS] Fecha del sistema: ${fechaFormateada} (${hoyISO})`);

  // Función para escribir en KV con limpieza de duplicados
  async function writeToKV(key, day, eventos) {
    const uniqueData = {};
    eventos.forEach(ev => {
      const keyEvent = `${ev.partido} ${ev.hora} ${ev.dia} ${ev.competicion}`.toLowerCase();
      if (!uniqueData[keyEvent]) {
        uniqueData[keyEvent] = [ev.deporte, ev.canales[0]?.label || ''];
      }
    });
    const payload = {
      timestamp: Date.now(),
      ttlMs: 86400000,
      day,
      data: uniqueData
    };
    try {
      await kvSetJsonTTLIfChanged(key, payload, 86400);
      console.info(`[EVENTOS] Escritura en KV ${key}: ${Object.keys(uniqueData).length} eventos`);
    } catch (err) {
      console.error(`[EVENTOS] Error escribiendo en KV ${key}: ${err.message}`);
    }
  }

  // Función para leer de KV
  async function readFromKV(key) {
    try {
      const payload = await kvGetJsonTTL(key);
      if (payload && typeof payload === 'object' && payload.data && Object.keys(payload.data).length > 0) {
        console.info(`[EVENTOS] Lectura de KV ${key}: ${Object.keys(payload.data).length} eventos`);
        return payload;
      }
      console.info(`[EVENTOS] KV ${key} vacío o inválido`);
      return null;
    } catch (err) {
      console.error(`[EVENTOS] Error leyendo de KV ${key}: ${err.message}`);
      return null;
    }
  }

  // Scrapear Marca
  async function scrapeMarca() {
    const eventos = [];
    const eventosUnicos = new Set();
    try {
      const MARCA_URL = 'https://www.marca.com/programacion-tv.html';
      const res = await fetch(MARCA_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; scraper)' } });
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
        const fechaTexto = $li.find('.title-section-widget').clone().children('strong').remove().end().text().trim();
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
          if ($ev.closest('li.content-item')[0] !== li) return;

          const hora = $ev.find('.dailyhour').text().trim() || '';
          const deporte = $ev.find('.dailyday').text().trim() || '';
          const competicion = $ev.find('.dailycompetition').text().trim() || '';
          const partido = $ev.find('.dailyteams').text().trim() || '';
          const canal = $ev.find('.dailychannel').text().trim() || '';

          const eventoId = `${fechaISO}|${hora}|${partido}|${competicion}`;
          if (eventosUnicos.has(eventoId)) return;
          eventosUnicos.add(eventoId);

          const evento = {
            dia: fechaFormateadaMarca,
            hora,
            deporte,
            competicion,
            partido,
            canales: canal ? [{ label: canal, url: null }] : []
          };

          eventos.push(evento);
          eventosCuentaBloque++;
        });

        console.info(`[EVENTOS] Eventos aceptados en bloque ${fechaISO}: ${eventosCuentaBloque}`);
      });

      console.info(`[EVENTOS] Scrapeo finalizado desde Marca: ${eventos.length} eventos`);
      return await scrapePostersForEventos(eventos);
    } catch (err) {
      console.warn(`[EVENTOS] Fallo al scrapear Marca: ${err.message}`);
      return [crearFallback(hoyISO)];
    }
  }

  // Lógica de cache
  let eventos = [];
  const eventosHoyKV = await readFromKV('EventosHoy');

  if (eventosHoyKV && isValidKVDay(eventosHoyKV.day, hoyDay)) {
    console.info('[EVENTOS] Usando cache de EventosHoy');
    eventos = Object.entries(eventosHoyKV.data).map(([key, value]) => ({
      partido: key.split(' ')[0],
      hora: key.split(' ')[1],
      dia: key.split(' ')[2],
      competicion: key.split(' ').slice(3).join(' '),
      deporte: value[0],
      canales: value[1] ? [{ label: value[1], url: null }] : [],
      poster: ''
    }));
  } else {
    // Mover EventosHoy a EventosAyer si es de ayer
    if (eventosHoyKV && isValidKVDay(eventosHoyKV.day, ayerDay)) {
      console.info('[EVENTOS] Moviendo EventosHoy a EventosAyer');
      const eventosAyer = Object.entries(eventosHoyKV.data).map(([key, value]) => ({
        partido: key.split(' ')[0],
        hora: key.split(' ')[1],
        dia: ayerDay,
        competicion: key.split(' ').slice(3).join(' '),
        deporte: value[0],
        canales: value[1] ? [{ label: value[1], url: null }] : [],
        poster: ''
      }));
      await writeToKV('EventosAyer', ayerDay, eventosAyer);
    }

    // Verificar EventosMañana
    const eventosMañanaKV = await readFromKV('EventosMañana');
    if (eventosMañanaKV && isValidKVDay(eventosMañanaKV.day, hoyDay)) {
      console.info('[EVENTOS] Promocionado EventosMañana → EventosHoy');
      eventos = Object.entries(eventosMañanaKV.data).map(([key, value]) => ({
        partido: key.split(' ')[0],
        hora: key.split(' ')[1],
        dia: hoyDay,
        competicion: key.split(' ').slice(3).join(' '),
        deporte: value[0],
        canales: value[1] ? [{ label: value[1], url: null }] : [],
        poster: ''
      }));
      await writeToKV('EventosHoy', hoyDay, eventos);
    } else {
      // Scrapear hoy
      const scrapedEventos = await scrapeMarca();
      eventos = scrapedEventos.filter(ev => ev.dia === hoyDay || eventoEsReciente(ev.dia, ev.hora));
      await writeToKV('EventosHoy', hoyDay, eventos);
    }

    // Scrapear mañana en segundo plano
    if (!eventosMañanaKV || !isValidKVDay(eventosMañanaKV.day, mañanaDay)) {
      console.info('[EVENTOS] Scrapeando eventos de mañana');
      Promise.resolve().then(async () => {
        const scrapedEventos = await scrapeMarca();
        const eventosMañana = scrapedEventos.filter(ev => ev.dia === mañanaDay);
        await writeToKV('EventosMañana', mañanaDay, eventosMañana);
      }).catch(err => {
        console.error(`[EVENTOS] Error en scrapeo de mañana: ${err.message}`);
      });
    }
  }

  if (eventos.length === 0) {
    console.warn(`[EVENTOS] No se encontraron eventos para hoy (${hoyISO})`);
    return [crearFallback(hoyISO)];
  }

  // Ordenar cronológicamente
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

  // Añadir posters
  eventos = await scrapePostersForEventos(eventos);

  return eventos;
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
