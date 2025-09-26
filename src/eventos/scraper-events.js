// src/eventos/scraper-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { scrapePosterForMatch } = require('./poster-events');
const { generatePlaceholdPoster } = require('./poster-events'); // asegúrate de exportarlo

async function fetchEventos(url) {
  try {
    const res = await fetch(url);
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

    // Verificar si hay eventos del día actual
    const hoy = new Date().toISOString().slice(0, 10); // formato YYYY-MM-DD
    const eventosHoy = eventos.filter(e => e.dia.includes(hoy));
    if (eventosHoy.length > 0) {
      console.info(`[EVENTOS] Web actualizada: se detectaron ${eventosHoy.length} eventos para hoy (${hoy})`);
    } else {
      console.warn(`[EVENTOS] Web desactualizada: ningún evento con fecha ${hoy}`);
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

    // Añadir pósters en paralelo con trazas
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
  } catch (err) {
    console.error('[EVENTOS] Error al scrapear:', err.message);
    return [];
  }
}

module.exports = { fetchEventos };
