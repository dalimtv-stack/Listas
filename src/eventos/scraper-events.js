// src/eventos/scraper-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { scrapePostersForEventos, generatePlaceholdPoster } = require('./poster-events');
const { DateTime } = require('luxon');

function parseFechaMarca(texto) {
  const meses = {
    enero: '01', febrero: '02', marzo: '03', abril: '04',
    mayo: '05', junio: '06', julio: '07', agosto: '08',
    septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
  };
  const match = texto.toLowerCase().match(/(\d{1,2}) de (\w+) de (\d{4})/);
  if (!match) return '';
  const [_, dd, mes, yyyy] = match;
  const mm = meses[mes] || '01';
  return `${yyyy}-${mm}-${dd.padStart(2, '0')}`;
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

function eventoEsReciente(dia, hora, deporte, partido, hoyISO, ayerISO, bloqueISO) {
  try {
    const [dd, mm, yyyy] = dia.split('/');
    const [hh, min] = hora.split(':');
    const evento = DateTime.fromObject({
      year: parseInt(yyyy),
      month: parseInt(mm),
      day: parseInt(dd),
      hour: parseInt(hh) || 0,
      minute: parseInt(min) || 0
    }, { zone: 'Europe/Madrid' });

    const referencia = DateTime.fromISO(bloqueISO, { zone: 'Europe/Madrid' }).startOf('day');
    const diffHoras = evento.diff(referencia, 'hours').hours;
    const eventoISO = evento.toISODate();

    console.info(`[EVENTOS] Evaluando evento: ${partido} a las ${hora} (${deporte}). Fecha: ${eventoISO}, Diff desde bloque: ${diffHoras.toFixed(2)}, bloque: ${bloqueISO}`);

    if (bloqueISO === hoyISO) return diffHoras >= 0 && diffHoras <= 24;
    if (bloqueISO === ayerISO) {
      const ahora = DateTime.now().setZone('Europe/Madrid');
      const diffDesdeAhora = ahora.diff(evento, 'hours').hours;
      return diffDesdeAhora >= 0 && diffDesdeAhora <= 2;
    }

    return false;
  } catch (e) {
    console.warn('[EVENTOS] Error en eventoEsReciente, aceptando por seguridad', e);
    return true;
  }
}
async function fetchEventos(url) {
  const eventos = [];
  const generos = [];
  const eventosUnicos = new Set();

  const ahoraDT = DateTime.now().setZone('Europe/Madrid');
  const hoyISO = ahoraDT.toISODate();
  const ayerISO = ahoraDT.minus({ days: 1 }).toISODate();
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

    const hasDaylist = $('li.content-item .title-section-widget').length > 0;
    const hasOldStructure = $('h3').length > 0 && $('ol.events-list').length > 0;

    const procesarEvento = (eventoLi, fechaISO, bloqueISO) => {
      const hora = $(eventoLi).find('.dailyhour, .hour').text().trim();
      const deporte = $(eventoLi).find('.dailyday, .sport').text().trim();
      const competicion = $(eventoLi).find('.dailycompetition, .competition').text().trim();
      const partido = $(eventoLi).find('.dailyteams, h4').text().trim();
      const canal = $(eventoLi).find('.dailychannel, .channel').text().trim();

      const eventoId = `${fechaISO}|${hora}|${partido}|${competicion}`;
      if (eventosUnicos.has(eventoId)) return;
      eventosUnicos.add(eventoId);

      const [yyyy, mm, dd] = fechaISO.split('-');
      const fechaFormateadaMarca = `${dd}/${mm}/${yyyy}`;

      if (!eventoEsReciente(fechaFormateadaMarca, hora, deporte, partido, hoyISO, ayerISO, bloqueISO)) return;

      if (deporte && !generos.includes(deporte)) generos.push(deporte);

      eventos.push({
        dia: fechaFormateadaMarca,
        hora,
        deporte,
        competicion,
        partido,
        canales: [{ label: canal, url: null }]
      });
    };

    if (hasDaylist) {
      console.info('[EVENTOS] Estructura detectada: daylist / dailyevent');
      $('li.content-item').each((_, li) => {
        const fechaTexto = $(li).find('.title-section-widget').text().trim();
        const fechaISO = parseFechaMarca(fechaTexto);
        if (!fechaISO) return;

        console.info(`[EVENTOS] Bloque con fecha detectada: ${fechaISO} (texto: "${fechaTexto.slice(0, 60)}")`);
        if (fechaISO !== hoyISO && fechaISO !== ayerISO) {
          console.info(`[EVENTOS] Saltando bloque con fecha ${fechaISO} (no es hoy ni ayer)`);
          return;
        }

        const bloqueISO = fechaISO;
        $(li).find('li.dailyevent').each((_, eventoLi) => procesarEvento(eventoLi, fechaISO, bloqueISO));
      });
    }

    if (hasOldStructure) {
      console.info('[EVENTOS] Estructura detectada: h3 + ol.events-list (antiguo)');
      $('h3').each((_, h3) => {
        const fechaTexto = $(h3).text().trim();
        const fechaISO = parseFechaMarca(fechaTexto);
        if (!fechaISO) return;

        console.info(`[EVENTOS] Bloque con fecha detectada: ${fechaISO} (h3: "${fechaTexto.slice(0, 60)}")`);
        if (fechaISO !== hoyISO && fechaISO !== ayerISO) {
          console.info(`[EVENTOS] Saltando bloque con fecha ${fechaISO} (no es hoy ni ayer)`);
          return;
        }

        const bloqueISO = fechaISO;
        const ol = $(h3).next('ol.events-list');
        ol.find('li.event-item').each((_, eventoLi) => procesarEvento(eventoLi, fechaISO, bloqueISO));
      });
    }

    console.info(`[EVENTOS] Scrapeo finalizado desde Marca: ${eventos.length} eventos`);
  } catch (err) {
    console.warn(`[EVENTOS] Fallo al scrapear Marca: ${err.message}`);
  }

  if (eventos.length === 0) {
    console.warn(`[EVENTOS] No se encontraron eventos para hoy (${hoyISO})`);
    const fallback = {
      dia: `${hoyISO.slice(8, 10)}/${hoyISO.slice(5, 7)}/${hoyISO.slice(0, 4)}`,
      hora: '',
      deporte: '',
      competicion: '',
      partido: 'No hay eventos disponibles hoy',
      canales: [],
      poster: generatePlaceholdPoster({
        hora: '',
        deporte: '',
        competicion: 'No hay eventos disponibles hoy'
      })
    };
    return [fallback];
  }

  const eventosConPosters = await scrapePostersForEventos(eventos);
  return eventosConPosters;
}

module.exports = { fetchEventos };
