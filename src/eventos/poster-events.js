// src/eventos/poster-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { scrapePostersForMatches } = require('./poster-events');

async function fetchEventos(url) {
  try {
    console.log(JSON.stringify({
      level: 'info',
      scope: 'scraper-events',
      message: 'Iniciando scraping de eventos',
      url
    }));

    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const eventos = [];

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

    console.log(JSON.stringify({
      level: 'info',
      scope: 'scraper-events',
      message: 'Eventos scrapeados',
      count: eventos.length
    }));

    // Añadir pósters a los eventos en lote
    const posterInputs = eventos.map(evento => ({
      partido: evento.partido,
      hora: evento.hora,
      deporte: evento.deporte,
      competicion: evento.competicion
    }));

    console.log(JSON.stringify({
      level: 'info',
      scope: 'scraper-events',
      message: 'Obteniendo pósters para eventos',
      eventos: eventos.length
    }));

    const posters = await scrapePostersForMatches(posterInputs);

    // Mapear pósters a los eventos
    eventos.forEach(evento => {
      const poster = posters.find(p => p.partido === evento.partido && p.posterUrl);
      evento.poster = poster ? poster.posterUrl : generatePlaceholdPoster({
        hora: evento.hora,
        deporte: evento.deporte,
        competicion: evento.competicion
      });
    });

    console.log(JSON.stringify({
      level: 'info',
      scope: 'scraper-events',
      message: 'Eventos con pósters generados',
      eventos: eventos.length
    }));

    return eventos;
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      scope: 'scraper-events',
      error: err.message,
      stack: err.stack
    }));
    return [];
  }
}

function generatePlaceholdPoster({ hora, deporte, competicion }) {
  const text = `${hora}\n \n${deporte}\n \n${competicion}`;
  return `https://placehold.co/938x1406@3x/999999/80f4eb?text=${encodeURIComponent(text)}&font=poppins&png`;
}

module.exports = { fetchEventos };
