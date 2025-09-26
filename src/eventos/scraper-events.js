// src/eventos/scraper-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { scrapePosterForMatch, generatePlaceholdPoster } = require('./poster-events');

function inferirDeporte(competicion) {
  const texto = competicion.toLowerCase();
  if (texto.includes('liga') || texto.includes('champions') || texto.includes('fútbol')) return 'Fútbol';
  if (texto.includes('nba') || texto.includes('baloncesto')) return 'Baloncesto';
  if (texto.includes('tenis')) return 'Tenis';
  if (texto.includes('f1') || texto.includes('formula')) return 'Fórmula 1';
  if (texto.includes('motogp') || texto.includes('moto')) return 'Motociclismo';
  return 'Deporte';
}

function parseEventos(html, url) {
  const $ = cheerio.load(html);
  const eventos = [];

  const encabezado = $('table thead tr').text().toLowerCase();

  if (encabezado.includes('día') && encabezado.includes('hora') && encabezado.includes('deporte')) {
    // Estructura tipo "Eventos Deportivos Acestream"
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
  } else if (encabezado.includes('hora del evento') && encabezado.includes('equipos')) {
    // Estructura tipo "HTML" con fecha en el título y partido dividido en dos celdas
    const fechaTexto = $('h1').text().match(/\d{2}-\d{2}-\d{4}/)?.[0] || '';
    $('table.styled-table tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      const hora = $(tds[0]).text().trim();
      const competicion = $(tds[1]).text().trim();
      const equipo1 = $(tds[2]).text().trim();
      const equipo2 = $(tds[3]).text().trim();
      const partido = `${equipo1} vs ${equipo2}`;
      const deporte = inferirDeporte(competicion);

      const canales = [];
      $(tds.slice(4)).find('a').each((_, a) => {
        const label = $(a).text().trim();
        const urlCanal = $(a).attr('href');
        canales.push({ label, url: urlCanal });
      });

      eventos.push({ dia: fechaTexto, hora, deporte, competicion, partido, canales });
    });
  } else {
    console.warn(`[EVENTOS] Estructura desconocida en ${url}`);
  }

  return eventos;
}

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

      // Buscar fecha de actualización en el texto
      const texto = $('body').text();
      const match = texto.match(/(?:EVENTOS DEL|Última actualización:)\s*(\d{2})[\/\-](\d{2})[\/\-](\d{4})/i);
      if (!match) {
        console.warn(`[EVENTOS] Fuente ${url} sin fecha detectable, ignorada`);
        continue;
      }

      const [_, dd, mm, yyyy] = match;
      const fechaFuente = `${yyyy}-${mm}-${dd}`;
      if (fechaFuente !== hoy) {
        console.warn(`[EVENTOS] Fuente ${url} desactualizada: ${fechaFuente}`);
        continue;
      }

      console.info(`[EVENTOS] Fuente ${url} actualizada: ${fechaFuente}`);

      const eventosFuente = parseEventos(html, url);
      eventos.push(...eventosFuente);
      console.info(`[EVENTOS] Scrapeo exitoso desde ${url}: ${eventosFuente.length} eventos`);
    } catch (err) {
      console.warn(`[EVENTOS] Fallo al scrapear ${url}: ${err.message}`);
    }
  }

  if (eventos.length === 0) {
    console.warn(`[EVENTOS] Ninguna fuente válida contiene eventos para hoy (${hoy})`);
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

  console.info(`[EVENTOS] Se detectaron ${eventos.length} eventos para hoy (${hoy})`);

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
