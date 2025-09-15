// api/scraper.js
'use strict';

const fetch = require('node-fetch');
const { kvGetJsonTTL, kvSetJsonTTL } = require('./kv.js');

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s*`\(.*?\)`\s*/g, '') // quita paréntesis y su contenido
    .replace(/\s+/g, ' ')
    .trim();
}

async function scrapeExtraWebs(ch) {
  if (!ch || !ch.name) {
    console.warn('[SCRAPER] Canal no definido o sin nombre');
    return [];
  }

  const normalizedTarget = normalizeName(ch.name);
  const cacheKey = `extra_streams:${ch.id}`;
  const ttlSeconds = 3600; // 1 hora

  // Intentar cache KV
  const cached = await kvGetJsonTTL(cacheKey);
  if (cached) {
    console.log(`[SCRAPER] Usando cache (${cached.length} resultados) para "${normalizedTarget}"`);
    return cached;
  }

  // Obtener lista de webs desde KV
  const webs = await kvGetJsonTTL('extra_webs') || [];
  if (!Array.isArray(webs) || webs.length === 0) {
    console.warn('[SCRAPER] No hay webs configuradas en KV para scrapear');
    return [];
  }

  console.log(`[SCRAPER] Iniciado para canal: ${ch.name}`);
  console.log(`[SCRAPER] Nombre normalizado: "${normalizedTarget}"`);
  console.log(`[SCRAPER] Lista de webs a scrapear:`, webs);

  let allResults = [];

  for (const web of webs) {
    console.log(`[SCRAPER] Fetch -> ${web}`);
    try {
      const res = await fetch(web, { timeout: 10000 });
      if (!res.ok) {
        console.warn(`[SCRAPER] Respuesta HTTP no OK (${res.status}) en ${web}`);
        continue;
      }

      const html = await res.text();

      // Buscar enlaces con su texto visible
      const linkRegex = /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
      let match;
      let matchedLinks = [];

      while ((match = linkRegex.exec(html)) !== null) {
        const url = match[1];
        const textNorm = normalizeName(match[2]);
        // Coincidencia si el texto visible contiene el nombre normalizado
        if (textNorm.includes(normalizedTarget)) {
          matchedLinks.push(url);
        }
      }

      console.log(`[SCRAPER] Coincidencias en ${web}: ${matchedLinks.length}`);
      matchedLinks.forEach(m => console.log(`  MATCH: ${m}`));

      allResults.push(...matchedLinks);

    } catch (err) {
      console.error(`[SCRAPER] Error al scrapear ${web}:`, err.message);
    }
  }

  console.log(`[SCRAPER] Total streams extra encontrados: ${allResults.length}`);

  // Guardar en cache KV
  await kvSetJsonTTL(cacheKey, allResults, ttlSeconds);

  return allResults;
}

module.exports = { scrapeExtraWebs };
