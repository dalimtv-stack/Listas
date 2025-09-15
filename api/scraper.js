// api/scraper.js
'use strict';

const fetch = require('node-fetch');
const { kvGetJsonTTL, kvSetJsonTTL } = require('./kv.js'); // Importar directo de kv.js

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, '') // quita paréntesis y su contenido
    .replace(/\s+/g, ' ')          // colapsa espacios
    .trim();
}

async function scrapeExtraWebs(ch) {
  const normalizedTarget = normalizeName(ch.name);
  const cacheKey = `extra_streams:${ch.id}`;
  const ttlSeconds = 3600; // 1 hora

  // Intentar cache KV
  const cached = await kvGetJsonTTL(cacheKey);
  if (cached) {
    console.log(`[SCRAPER] Usando cache (${cached.length} resultados)`);
    return cached;
  }

  const webs = [
    'https://ipfs.io/ipns/elcano.top',
    'https://shickat.me'
  ];

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

      // Extraer todos los enlaces como fallback
      const allLinks = Array.from(html.matchAll(/https?:\/\/[^\s"'<>]+/g)).map(m => m[0]);
      console.log(`[SCRAPER] Total enlaces encontrados en ${web}: ${allLinks.length}`);

      // Filtrar por coincidencia normalizada
      const matched = allLinks.filter(link =>
        normalizeName(link).includes(normalizedTarget)
      );

      if (matched.length > 0) {
        console.log(`[SCRAPER] Coincidencias en ${web}: ${matched.length}`);
        matched.forEach(m => console.log(`  MATCH: ${m}`));
        allResults.push(...matched);
      } else {
        console.warn(`[SCRAPER] 0 coincidencias en ${web} para "${normalizedTarget}"`);
        console.log(`[SCRAPER] Mostrando primeros 10 enlaces para inspección:`);
        allLinks.slice(0, 10).forEach(l => console.log(`  LINK: ${l}`));
        // Fallback: añadir todos los enlaces
        allResults.push(...allLinks);
      }
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
