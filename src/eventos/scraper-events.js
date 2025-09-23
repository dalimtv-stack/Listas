'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');

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
        canales.push({
          label: $(a).text().trim(),
          url: $(a).attr('href')
        });
      });

      eventos.push({ dia, hora, deporte, competicion, partido, canales });
    });

    return eventos;
  } catch (err) {
    console.error('[EVENTOS] Error al scrapear:', err.message);
    return [];
  }
}

module.exports = { fetchEventos };
