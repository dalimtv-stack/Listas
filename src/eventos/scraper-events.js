// src/eventos/scraper-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { scrapePosterForMatch, generatePlaceholdPoster } = require('./poster-events');

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

const { DateTime } = require('luxon');

function eventoEsReciente(dia, hora) {
  const [dd, mm, yyyy] = dia.split('/');
  const [hh, min] = hora.split(':');
  const evento = DateTime.fromObject({
    year: parseInt(yyyy),
    month: parseInt(mm),
    day: parseInt(dd),
    hour: parseInt(hh),
    minute: parseInt(min)
  }, { zone: 'Europe/Madrid' });

  const ahora = DateTime.now().setZone('Europe/Madrid');
  const diffHoras = ahora.diff(evento, 'hours').hours;
  return diffHoras <= 4;
}

async function fetchEventos(url) {
  const eventos = [];
  const generos = [];
  const ahora = new Date();
  const hoyISO = ahora.toISOString().slice(0, 10);
  const fechaFormateada = formatoFechaES(ahora);

  console.info(`[EVENTOS] Fecha del sistema: ${fechaFormateada} (${hoyISO})`);

  try {
    const res = await fetch('https://www.marca.com/programacion-tv.html');
    if (!res.ok) throw new Error(`HTTP ${res.status} en Marca`);
    const buffer = await res.buffer();
    const html = iconv.decode(buffer, 'latin1');
    const $ = cheerio.load(html);

    const fechaTexto = $('span.title-section-widget').text().match(/\d{1,2} de \w+ de \d{4}/)?.[0] || '';
    const fechaMarcaISO = parseFechaMarca(fechaTexto);

    if (fechaMarcaISO !== hoyISO) {
      console.warn(`[EVENTOS] Marca muestra eventos para ${fechaMarcaISO}, no para hoy (${hoyISO})`);
      return [];
    }

    const [yyyy, mm, dd] = fechaMarcaISO.split('-');
    const fechaFormateadaMarca = `${dd}/${mm}/${yyyy}`;

    $('li.dailyevent').each((_, li) => {
      const hora = $(li).find('.dailyhour').text().trim();
      const deporte = $(li).find('.dailyday').text().trim();
      const competicion = $(li).find('.dailycompetition').text().trim();
      const partido = $(li).find('.dailyteams').text().trim();
      const canal = $(li).find('.dailychannel').text().replace(/^\s*[\w\s]+/i, '').trim();

      if (!eventoEsReciente(fechaFormateadaMarca, hora)) return;

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

    console.info(`[EVENTOS] Scrapeo exitoso desde Marca: ${eventos.length} eventos`);
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

  await Promise.all(eventos.map(async evento => {
    console.time(`Poster ${evento.partido}`);
    evento.poster = await scrapePosterForMatch({
      partido: evento.partido,
      hora: evento.hora,
      deporte: evento.deporte,
      competicion: evento.competicion
    });
    console.timeEnd(`Poster ${evento.partido}`);
  }));

  return eventos;
}

module.exports = { fetchEventos };
