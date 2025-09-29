// src/eventos/scraper-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { scrapePosterForMatch, generatePlaceholdPoster } = require('./poster-events');
const { DateTime } = require('luxon');

function parseFechaMarca(texto) {
  const meses = {
    enero: '01', febrero: '02', marzo: '03', abril: '04',
    mayo: '05', junio: '06', julio: '07', agosto: '08',
    septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
  };
  const matches = (texto || '').toLowerCase().match(/(\d{1,2} de \w+ de \d{4})/g) || [];
  if (matches.length !== 1) {
    console.warn(`[EVENTOS] Fecha no válida o contiene múltiples fechas: "${texto}" (encontradas: ${matches.length})`);
    return '';
  }
  const match = (texto || '').toLowerCase().match(/(\d{1,2}) de (\w+) de (\d{4})/);
  if (!match) return '';
  const [_, dd, mes, yyyy] = match;
  const mm = meses[mes] || '01';
  return `${yyyy}-${mm}-${dd.padStart(2, '0')}`;
}

function formatoFechaES(fecha) {
  const opciones = {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  };
  return new Intl.DateTimeFormat('es-ES', opciones).format(fecha);
}

function eventoEsReciente(dia, hora, deporte, partido, hoyISO, ayerISO, bloqueISO) {
  try {
    const [dd, mm, yyyy] = (dia || '').split('/');
    const [hh, min] = (hora || '').split(':');
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

    if (bloqueISO === hoyISO) {
      // mostrar todos los eventos del día
      return diffHoras >= 0 && diffHoras <= 24;
    }

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

    const hasDaylist = ($('ol.auto-items.daylist').length > 0) || ($('li.dailyevent').length > 0) || ($('.title-section-widget').length > 0);
    const hasOldStructure = ($('h3').length > 0 && $('ol.events-list').length > 0) || ($('li.event-item').length > 0);

    if (hasDaylist) {
      console.info('[EVENTOS] Estructura detectada: daylist / dailyevent');
      $('li.content-item').filter((i, el) => $(el).find('.title-section-widget').length > 0).each((_, li) => {
        const fechaTexto = $(li).find('.title-section-widget').text().trim();
        const fechaISO = parseFechaMarca(fechaTexto);

        console.info(`[EVENTOS] Bloque con fecha detectada: ${fechaISO} (texto: "${fechaTexto.replace(/\s+/g,' ').trim().slice(0,60)}")`);

        if (fechaISO !== hoyISO && fechaISO !== ayerISO) {
          console.info(`[EVENTOS] Saltando bloque con fecha ${fechaISO} (no es hoy ni ayer)`);
          return;
        }

        const bloqueISO = fechaISO;
        const [yyyy, mm, dd] = fechaISO.split('-');
        const fechaFormateadaMarca = `${dd}/${mm}/${yyyy}`;

        $(li).find('li.dailyevent').each((_, eventoLi) => {
          const hora = $(eventoLi).find('.dailyhour').text().trim() || '';
          const deporte = $(eventoLi).find('.dailyday').text().trim() || '';
          const competicion = $(eventoLi).find('.dailycompetition').text().trim() || '';
          const partido = $(eventoLi).find('.dailyteams').text().trim() || '';
          const canal = $(eventoLi).find('.dailychannel').text().trim() || '';

          const eventoId = `${fechaISO}|${hora}|${partido}|${competicion}`;
          if (eventosUnicos.has(eventoId)) {
            console.info(`[EVENTOS] Evento duplicado descartado: ${partido} a las ${hora}`);
            return;
          }
          eventosUnicos.add(eventoId);

          if (!eventoEsReciente(fechaFormateadaMarca, hora, deporte, partido, hoyISO, ayerISO, bloqueISO)) {
            console.info(`[EVENTOS] Evento ${partido} a las ${hora} descartado (no reciente)`);
            return;
          }
          if (deporte && !generos.includes(deporte)) generos.push(deporte);

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
    }

    if (hasOldStructure) {
      console.info('[EVENTOS] Estructura detectada: h3 + ol.events-list (antiguo)');
      $('h3').each((_, h3) => {
        const fechaTexto = $(h3).text().trim();
        const fechaISO = parseFechaMarca(fechaTexto);

        console.info(`[EVENTOS] Bloque con fecha detectada: ${fechaISO} (h3: "${fechaTexto.replace(/\s+/g,' ').trim().slice(0,60)}")`);

        if (fechaISO !== hoyISO && fechaISO !== ayerISO) {
          console.info(`[EVENTOS] Saltando bloque con fecha ${fechaISO} (no es hoy ni ayer)`);
          return;
        }

        const bloqueISO = fechaISO;
        const [yyyy, mm, dd] = fechaISO.split('-');
        const fechaFormateadaMarca = `${dd}/${mm}/${yyyy}`;

        const ol = $(h3).next('ol.events-list');
        ol.find('li.event-item').each((_, eventoLi) => {
          const hora = $(eventoLi).find('.hour').text().trim() || '';
          const deporte = $(eventoLi).find('.sport').text().trim() || '';
          const competicion = $(eventoLi).find('.competition').text().trim() || '';
          const partido = $(eventoLi).find('h4').text().trim() || '';
          const canal = $(eventoLi).find('.channel').text().trim() || '';

          const eventoId = `${fechaISO}|${hora}|${partido}|${competicion}`;
          if (eventosUnicos.has(eventoId)) {
            console.info(`[EVENTOS] Evento duplicado descartado: ${partido} a las ${hora}`);
            return;
          }
          eventosUnicos.add(eventoId);

          if (!eventoEsReciente(fechaFormateadaMarca, hora, deporte, partido, hoyISO, ayerISO, bloqueISO)) {
            console.info(`[EVENTOS] Evento ${partido} a las ${hora} descartado (no reciente)`);
            return;
          }
          if (deporte && !generos.includes(deporte)) generos.push(deporte);

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

  await Promise.all(eventos.map(async (evento, index) => {
    const posterLabel = `Poster ${evento.partido}-${index}`;
    console.time(posterLabel);
    evento.poster = await scrapePosterForMatch({
      partido: evento.partido,
      hora: evento.hora,
      deporte: evento.deporte,
      competicion: evento.competicion
    });
    console.timeEnd(posterLabel);
  }));

  return eventos;
}

module.exports = { fetchEventos };