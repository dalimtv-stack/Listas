// api/scraper.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJsonTTL, kvSetJsonTTL } = require('./kv');

const channelAliases = {
  'movistar laliga (fhd)': ['m. laliga', 'm. laliga 1080p', 'movistar laliga'],
  'dazn f1 (fhd)': ['dazn f1', 'dazn f1 1080', 'dazn f1 1080  (fórmula 1)', 'fórmula 1'],
  'primera federacion "rfef" (fhd)': ['rfef', 'primera federacion', 'primera federación'],
  'movistar plus (1080)': ['movistar plus', 'm. plus', 'movistar plus fhd', 'movistar+', 'plus fhd']
};

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s*`\(.*?\)`\s*/g, '') // Quita paréntesis y su contenido
    .replace(/\s*\(.*?\)\s*/g, '')  // Añade eliminación de paréntesis sin comillas
    .replace(/\s+/g, ' ')
    .trim();
}

function getSearchTerms(channelName) {
  const normalized = normalizeName(channelName);
  return channelAliases[normalized] || [normalized];
}

// Nueva función para normalizar URLs y quitar prefijos
function normalizeUrlForDisplay(url) {
  return String(url || '')
    .replace(/^https?:\/\/(www\.)?/, '') // Elimina http://, https://, www.
    .replace(/\/+$/, ''); // Elimina barras finales
}

async function scrapeExtraWebs(channelName, extraWebsList) {
  const logPrefix = '[SCRAPER]';
  if (!channelName || typeof channelName !== 'string') {
    console.warn(logPrefix, 'Nombre de canal no definido o inválido');
    return [];
  }

  const normalizedTarget = normalizeName(channelName);
  const cacheKey = `scrape:${normalizedTarget}`;
  const ttlSeconds = 1800; // 30 minutos

  const cached = await kvGetJsonTTL(cacheKey);
  if (cached) {
    console.log(logPrefix, `Usando cache (${cached.length} resultados) para "${normalizedTarget}"`);
    return cached;
  }

  if (!Array.isArray(extraWebsList) || extraWebsList.length === 0) {
    console.warn(logPrefix, 'No hay webs configuradas para scrapear');
    return [];
  }

  console.log(logPrefix, `Iniciado para canal: ${channelName}`);
  console.log(logPrefix, `Nombre normalizado: "${normalizedTarget}"`);
  console.log(logPrefix, `Lista de webs a scrapear:`, extraWebsList);

  const results = [];
  const seenUrls = new Set();
  const searchTerms = getSearchTerms(channelName).map(s => normalizeName(s));

  for (const url of extraWebsList) {
    try {
      console.log(logPrefix, `Fetch -> ${url}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const html = await fetch(url, { signal: controller.signal }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      });
      clearTimeout(timeoutId);

      const $ = cheerio.load(html);
      let encontrados = 0;

      // Estructura Elcano.top
      $('#linksList li').each((_, li) => {
        const name = $(li).find('.link-name').text().trim();
        const href = $(li).find('.link-url a').attr('href');
        const normalizedName = normalizeName(name); // Normalizar el nombre extraído
        if (
          name &&
          href &&
          href.startsWith('acestream://') &&
          searchTerms.some(term => normalizedName.includes(term)) &&
          !seenUrls.has(href)
        ) {
          const displayName = normalizeUrlForDisplay(url); // Usar URL normalizada para name
          const stream = {
            name: displayName,
            title: `${name} (extra)`,
            externalUrl: href,
            group_title: displayName, // Usar la misma normalización para group_title
            behaviorHints: { notWebReady: true, external: true }
          };
          results.push(stream);
          seenUrls.add(href);
          encontrados++;
          console.log(logPrefix, `Stream añadido: ${JSON.stringify(stream)}`);
        }
      });

      // Estructura Shickat
      $('.canal-card').each((_, card) => {
        const name = $(card).find('.canal-nombre').text().trim();
        const href = $(card).find('.acestream-link').attr('href');
        const normalizedName = normalizeName(name); // Normalizar el nombre extraído
        if (
          name &&
          href &&
          href.startsWith('acestream://') &&
          searchTerms.some(term => normalizedName.includes(term)) &&
          !seenUrls.has(href)
        ) {
          const displayName = normalizeUrlForDisplay(url); // Usar URL normalizada para name
          const stream = {
            name: displayName,
            title: `${name} (extra)`,
            externalUrl: href,
            group_title: displayName, // Usar la misma normalización para group_title
            behaviorHints: { notWebReady: true, external: true }
          };
          results.push(stream);
          seenUrls.add(href);
          encontrados++;
          console.log(logPrefix, `Stream añadido: ${JSON.stringify(stream)}`);
        }
      });

      console.log(logPrefix, `Coincidencias en ${url}: ${encontrados}`);
    } catch (e) {
      console.error(logPrefix, `Error en ${url}:`, e.message);
    }
  }

  console.log(logPrefix, `Total streams extra encontrados: ${results.length}`);
  await kvSetJsonTTL(cacheKey, results, ttlSeconds);
  return results;
}

module.exports = { scrapeExtraWebs };
