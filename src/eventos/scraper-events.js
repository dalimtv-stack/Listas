// src/eventos/scraper-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
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

async function fetchEventos() {
  const url = 'https://www.marca.com/programacion-tv.html';
  const eventos = [];

  const ahora = new Date();
  const hoyISO = ahora.toISOString().slice(0, 10);
  console.info(`[EVENTOS] Fecha del sistema: ${ahora.toLocaleString('es-ES')} (${hoyISO})`);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const fechaTexto = $('span.title-section-widget').text().match(/\d{1,2} de \w+ de \d{4}/)?.[0] || '';
    const fechaMarca = parseFechaMarca(fechaTexto);

    if (fechaMarca !== hoyISO) {
      console.warn(`[EVENTOS] Marca muestra eventos para ${fechaMarca}, no para hoy (${hoyISO})`);
      return [];
    }

    $('li.dailyevent').each((_, li) => {
      const hora = $(li).find('.dailyhour').text().trim();
      const deporte = $(li).find('.dailyday').text().trim();
      const competicion = $(li).find('.dailycompetition').text().trim();
      const partido = $(li).find('.dailyteams').text().trim();
      const canal = $(li).find('.dailychannel').text().replace(/^\s*[\w\s]+/i, '').trim();

      eventos.push({
        dia: fechaMarca,
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
      dia: hoyISO,
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
