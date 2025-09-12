'use strict';

// -------------------- scraper.js --------------------
// Encargado de scrapear webs adicionales y devolver streams compatibles con Stremio

const fetch = require('node-fetch');
const cheerio = require('cheerio'); // npm install cheerio
const { kvGetJsonTTL, kvSetJsonTTL } = require('./index'); // Usa las funciones TTL de tu index.js

/**
 * Scrapea las webs adicionales buscando streams para un canal concreto.
 * @param {string} channelName - Nombre del canal (ej: "La 2")
 * @param {string[]} extraWebsList - Lista de URLs de webs a scrapear
 * @returns {Promise<Array>} - Array de objetos stream para Stremio
 */
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

  for (const url of extraWebsList) {
    try {
      console.log(`[SCRAPER] Buscando en ${url} para canal ${channelName}`);
      const html = await fetch(url, { timeout: 8000 }).then(r => r.text());
      const $ = cheerio.load(html);
      let encontrados = 0;

      // Buscar solo coincidencias con el canal
      $('#linksList li').each((_, li) => {
        const name = $(li).find('.link-name').text().trim();
        const href = $(li).find('.link-url a').attr('href');

        if (
          name &&
          href &&
          href.startsWith('acestream://') &&
          name.toLowerCase().includes(channelName.toLowerCase())
        ) {
          results.push({
            name: `${name} (extra)`,
            title: `${name} (extra)`,
            url: href
          });
          encontrados++;
        }
      });
      console.log(`[SCRAPER] Coincidencias exactas en ${url}: ${encontrados}`);

      // Si no encontró nada para ese canal, usar todos los enlaces de la página
      if (results.length === 0) {
        console.log(`[SCRAPER] No se encontraron coincidencias exactas, usando todos los enlaces de ${url}`);
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
      }

    } catch (e) {
      console.error(`[SCRAPER] Error scrapeando ${url}:`, e.message);
    }
  }
  console.log(`[SCRAPER] Total streams extra encontrados: ${results.length}`);

  // Guardar en cache con TTL de 1 hora (3600 segundos)
  await kvSetJsonTTL(cacheKey, results, 3600);

  return results;
}

module.exports = { scrapeExtraWebs };
