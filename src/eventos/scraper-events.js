// src/eventos/scraper-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { scrapePosterForMatch, generatePlaceholdPoster } = require('./poster-events');
const { kvGetJsonTTL } = require('../../api/kv');
const { DateTime } = require('luxon');

function parseFechaMarca(texto) {
  const meses = {
    enero: '01', febrero: '02', marzo: '03', abril: '04',
    mayo: '05', junio: '06', julio: '07', agosto: '08',
    septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
  };
  const match = (texto || '').toLowerCase().match(/(\d{1,2}) de (\w+) de (\d{4})/);
  if (!match) {
    console.warn(`[EVENTOS] No se encontró ninguna fecha válida en: "${texto}"`);
    return '';
  }
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

function eventoEsReciente(dia, hora, deporte, partido) {
  try {
    const ahora = DateTime.now().setZone('Europe/Madrid');
    const [dd, mm, yyyy] = (dia || '').split('/');
    const [hh, min] = (hora || '').split(':');
    const evento = DateTime.fromObject({
      year: parseInt(yyyy),
      month: parseInt(mm),
      day: parseInt(dd),
      hour: parseInt(hh) || 0,
      minute: parseInt(min) || 0
    }, { zone: 'Europe/Madrid' });

    const eventoISODate = evento.toISODate();
    const hoyISO = ahora.toISODate();
    const ayerISO = ahora.minus({ days: 1 }).toISODate();
    const mañanaISO = ahora.plus({ days: 1 }).toISODate();

    if (eventoISODate === hoyISO) {
      const diffDesdeAhora = ahora.diff(evento, 'hours').hours;
      return diffDesdeAhora >= -24 && diffDesdeAhora <= 3;
    }

    if (eventoISODate === ayerISO) {
      const diffDesdeAhora = ahora.diff(evento, 'hours').hours;
      return diffDesdeAhora >= 0 && diffDesdeAhora <= 2;
    }

    if (eventoISODate === mañanaISO) {
      const diffDesdeAhora = evento.diff(ahora, 'hours').hours;
      return diffDesdeAhora >= 0 && diffDesdeAhora <= 3;
    }

    return false;
  } catch (e) {
    console.warn('[EVENTOS] Error en eventoEsReciente, aceptando por seguridad', e);
    return true;
  }
}

async function fetchEventos(url) {
  const eventos = [];
  const eventosUnicos = new Set();

  const ahoraDT = DateTime.now().setZone('Europe/Madrid');
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

    const bloques = $('li.content-item').filter((i, el) => $(el).find('.title-section-widget').length > 0);
    if (bloques.length === 0) {
      console.warn('[EVENTOS] No se encontraron bloques con fecha válida');
      return [crearFallback(hoyISO)];
    }

    console.info('[EVENTOS] Estructura detectada: daylist / dailyevent');
    bloques.each((_, li) => {
      const fechaTexto = $(li).find('.title-section-widget').text().trim();
      const fechaISO = parseFechaMarca(fechaTexto);
      const [yyyy, mm, dd] = fechaISO.split('-');
      const fechaFormateadaMarca = `${dd}/${mm}/${yyyy}`;

      $(li).find('li.dailyevent').each((_, eventoLi) => {
        const hora = $(eventoLi).find('.dailyhour').text().trim() || '';
        const deporte = $(eventoLi).find('.dailyday').text().trim() || '';
        const competicion = $(eventoLi).find('.dailycompetition').text().trim() || '';
        const partido = $(eventoLi).find('.dailyteams').text().trim() || '';
        const canal = $(eventoLi).find('.dailychannel').text().trim() || '';

        const eventoId = `${fechaISO}|${hora}|${partido}|${competicion}`;
        if (eventosUnicos.has(eventoId)) return;
        eventosUnicos.add(eventoId);

        if (!eventoEsReciente(fechaFormateadaMarca, hora, deporte, partido)) return;

        eventos.push({
          dia: fechaFormateadaMarca,
          hora,
          deporte,
          competicion,
          partido,
          canales: [{ label: canal, url: null }]
        });
      });
    });

    console.info(`[EVENTOS] Scrapeo finalizado desde Marca: ${eventos.length} eventos`);
  } catch (err) {
    console.warn(`[EVENTOS] Fallo al scrapear Marca: ${err.message}`);
  }

  if (eventos.length === 0) {
    console.warn(`[EVENTOS] No se encontraron eventos para hoy (${hoyISO})`);
    return [crearFallback(hoyISO)];
  }

  const postersMap = await kvGetJsonTTL('postersBlobHoy') || {};
  await Promise.all(eventos.map(async (evento, index) => {
    const posterLabel = `Poster ${evento.partido}-${index}`;
    console.time(posterLabel);
    evento.poster = await scrapePosterForMatch({
      partido: evento.partido,
      hora: evento.hora,
      deporte: evento.deporte,
      competicion: evento.competicion
    }, postersMap);
    console.timeEnd(posterLabel);
  }));

  return eventos;
}

function crearFallback(hoyISO) {
  const dia = `${hoyISO.slice(8, 10)}/${hoyISO.slice(5, 7)}/${hoyISO.slice(0, 4)}`;
  return {
    dia,
    hora: '',
    deporte: '',
    competicion: 'No hay eventos disponibles hoy',
    partido: 'No hay eventos disponibles hoy',
    canales: [],
    poster: `https://dummyimage.com/300x450/000/fff&text=${encodeURIComponent(partido)}`
  };
}

module.exports = { fetchEventos };
