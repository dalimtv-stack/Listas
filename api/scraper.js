//api/scraper.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJsonTTL, kvSetJsonTTL } = require('./index');

// Equivalencias entre nombres M3U y nombres en las webs
const channelAliases = {
  'movistar laliga (fhd)': ['m. laliga', 'm. laliga 1080p', 'movistar laliga'],
  'dazn f1 (fhd)': ['dazn f1', 'dazn f1 1080', 'dazn f1 1080  (fórmula 1)', 'fórmula 1'],
  'primera federacion "rfef" (fhd)': ['rfef', 'primera federacion', 'primera federación']
};

function getSearchTerms(channelName) {
  const normalized = channelName.trim().toLowerCase();
  return channelAliases[normalized] || [channelName];
}

async function scrapeExtraWebs(channelName, extraWebsList) {
  console.log(`[SCRAPER] Iniciado para canal: ${channelName}`);
  console.log(`[SCRAPER] Lista de webs a scrapear:`, extraWebsList);

  const cacheKey = `scrape:${channelName.toLowerCase()}`;
  const cached = await kvGetJsonTTL(cacheKey);
  if (cached) {
    console.log(`[SCRAPER] Usando cache (${cached.length} resultados)`);
    return cached;
  }

  const results = [];
  const searchTerms = getSearchTerms(channelName).map(s => s.toLowerCase());

  for (const url of extraWebsList) {
    try {
      console.log(`[SCRAPER] Fetch -> ${url}`);
      const html = await fetch(url, { timeout: 8000 }).then(r => r.text());
      const $ = cheerio.load(html);

      let encontrados = 0;

      // 🔹 Estructura Elcano.top
      $('#linksList li').each((_, li) => {
        const name = $(li).find('.link-name').text().trim();
        const href = $(li).find('.link-url a').attr('href');
        if (
          name &&
          href &&
          href.startsWith('acestream://') &&
          searchTerms.some(term => name.toLowerCase().includes(term))
        ) {
          results.push({
            name: `${name} (extra)`,
            title: `${name} (extra)`,
            url: href
          });
          encontrados++;
        }
      });

      // 🔹 Estructura Shickat
      $('.canal-card').each((_, card) => {
        const name = $(card).find('.canal-nombre').text().trim();
        const href = $(card).find('.acestream-link').attr('href');
        if (
          name &&
          href &&
          href.startsWith('acestream://') &&
          searchTerms.some(term => name.toLowerCase().includes(term))
        ) {
          results.push({
            name: `${name} (extra)`,
            title: `${name} (extra)`,
            url: href
          });
          encontrados++;
        }
      });

      console.log(`[SCRAPER] Coincidencias en ${url}: ${encontrados}`);

      if (encontrados === 0) {
        console.log(`[SCRAPER] Fallback: añadiendo todos los enlaces de ${url}`);

        // Fallback Elcano
        $('#linksList li').each((_, li) => {
          const name = $(li).find('.link-name').text().trim();
          const href = $(li).find('.link-url a').attr('href');
          if (name && href && href.startsWith('acestream://')) {
            results.push({
              name: `${name} (extra)`,
              title: `${name} (extra)`,
              url: href
            });
          }
        });

        // Fallback Shickat
        $('.canal-card').each((_, card) => {
          const name = $(card).find('.canal-nombre').text().trim();
          const href = $(card).find('.acestream-link').attr('href');
          if (name && href && href.startsWith('acestream://')) {
            results.push({
              name: `${name} (extra)`,
              title: `${name} (extra)`,
              url: href
            });
          }
        });
      }

    } catch (e) {
      console.error(`[SCRAPER] Error en ${url}:`, e.message);
    }
  }

  console.log(`[SCRAPER] Total streams extra encontrados: ${results.length}`);
  await kvSetJsonTTL(cacheKey, results, 3600);
  return results;
}

module.exports = { scrapeExtraWebs };
