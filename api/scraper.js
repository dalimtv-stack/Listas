// -------------------- scraper.js --------------------
// Encargado de scrapear webs adicionales y devolver streams compatibles con Stremio

const { kvGetJsonTTL, kvSetJsonTTL } = require('./db');
const fetch = require('node-fetch'); // Asegúrate de tenerlo instalado
const cheerio = require('cheerio');  // npm install cheerio

/**
 * Scrapea las webs adicionales buscando streams para un canal concreto.
 * @param {string} channelName - Nombre del canal (ej: "La 2")
 * @param {string} extraWebsString - Lista de webs separadas por ; o |
 * @returns {Promise<Array>} - Array de objetos stream para Stremio
 */
async function scrapeExtraWebs(channelName, extraWebsString) {
  const cacheKey = `scrape:${channelName.toLowerCase()}`;
  const cached = await kvGetJsonTTL(cacheKey);
  if (cached) {
    console.log(`[SCRAPER] Usando cache para ${channelName}`);
    return cached;
  }

  const urls = extraWebsString.split(/;|\|/).map(u => u.trim()).filter(Boolean);
  const results = [];

  for (const url of urls) {
    try {
      console.log(`[SCRAPER] Buscando en ${url} para canal ${channelName}`);
      const html = await fetch(url, { timeout: 8000 }).then(r => r.text());
      const $ = cheerio.load(html);

      // --------------------
      // Aquí debes adaptar el selector y la lógica de extracción
      // según la estructura HTML de tus webs.
      // Ejemplo genérico: buscar enlaces que contengan el nombre del canal
      // --------------------
      $('a, source').each((_, el) => {
        const text = $(el).text() || $(el).attr('src') || '';
        if (text.toLowerCase().includes(channelName.toLowerCase())) {
          const streamUrl = $(el).attr('href') || $(el).attr('src');
          if (streamUrl && (streamUrl.startsWith('http') || streamUrl.startsWith('acestream://'))) {
            results.push({
              name: `${channelName} (extra)`,
              title: `${channelName} (extra)`,
              url: streamUrl
            });
          }
        }
      });

    } catch (e) {
      console.error(`[SCRAPER] Error scrapeando ${url}:`, e.message);
    }
  }

  // Guardar en cache con TTL de 1 hora
  await kvSetJsonTTL(cacheKey, results, 3600);
  return results;
}

module.exports = { scrapeExtraWebs };
