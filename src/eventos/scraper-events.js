// src/eventos/scraper-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { scrapePosterForMatch, generatePlaceholdPoster } = require('./poster-events');

async function fetchEventos(configure) {
  const urls = configure.split(/;|\|/).map(u => u.trim()).filter(Boolean);
  const hoy = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const eventos = [];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
      const html = await res.text();
      const $ = cheerio.load(html);

      $('table tbody tr').each((_, tr) => {
        const tds = $(tr).find('td');
        const dia = $(tds[0]).text().trim();
        const hora = $(tds[1]).text().trim();
        const deporte = $(tds[2]).text().trim();
        const competicion = $(tds[3]).text().trim();
        const partido = $(tds[4]).text().trim();

        const canales = [];
        $(tds[5]).find('a').each((_, a) => {
          const label = $(a).text().trim();
          const urlCanal = $(a).attr('href');
          canales.push({ label, url: urlCanal });
        });

        eventos.push({ dia, hora, deporte, competicion, partido, canales });
      });

      console.info(`[EVENTOS] Scrapeo exitoso desde ${url}`);
    } catch (err) {
      console.warn(`[EVENTOS] Fallo al scrapear ${url}: ${err.message}`);
    }
  }

  const eventosHoy = eventos.filter(e => e.dia.includes(hoy));
  if (eventosHoy.length === 0) {
    console.warn(`[EVENTOS] Ninguna fuente contiene eventos para hoy (${hoy})`);
    const fallback = {
      dia: hoy,
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

  console.info(`[EVENTOS] Se detectaron ${eventosHoy.length} eventos para hoy (${hoy})`);

  await Promise.all(eventosHoy.map(async evento => {
    console.time(`Poster ${evento.partido}`);
    evento.poster = await scrapePosterForMatch({
      partido: evento.partido,
      hora: evento.hora,
      deporte: evento.deporte,
      competicion: evento.competicion
    });
    console.timeEnd(`Poster ${evento.partido}`);
  }));

  return eventosHoy;
}

module.exports = { fetchEventos };
