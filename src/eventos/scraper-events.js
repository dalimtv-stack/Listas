'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');

async function fetchEventos(url) {
  console.log('[EVENTOS] Scrapeando:', url);
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
        const href = $(a).attr('href');
        const label = $(a).text().trim();
        canales.push({
          label,
          url: href
        });
      });

      eventos.push({
        dia,
        hora,
        deporte,
        competicion,
        partido,
        canales
      });
    });

    console.log(`[EVENTOS] Extraídos ${eventos.length} eventos`);
    return eventos;
  } catch (err) {
    console.error('[EVENTOS] Error al scrapear:', err.message);
    return [];
  }
}

module.exports = { fetchEventos };
