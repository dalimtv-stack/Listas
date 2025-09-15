// api/scraper.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJsonTTL, kvSetJsonTTL } = require('./kv');

const channelAliases = {
  'movistar laliga (fhd)': ['m. laliga', 'm. laliga 1080p', 'movistar laliga'],
  'dazn f1 (fhd)': ['dazn f1', 'dazn f1 1080', 'dazn f1 1080  (fórmula 1)', 'fórmula 1'],
  'primera federacion "rfef" (fhd)': ['rfef', 'primera federacion', 'primera federación'],
  'movistar plus (1080)': ['movistar plus', 'm. plus', 'movistar plus fhd'] // Añadido para el canal del log
};

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s*`\(.*?\)`\s*/g, '') // Quita paréntesis y su contenido
    .replace(/\s+/g, ' ')
    .trim();
}

function getSearchTerms(channelName) {
  const normalized = normalizeName(channelName);
  return channelAliases[normalized] || [channelName];
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
        if (
          name &&
          href &&
          href.startsWith('acestream://') &&
          searchTerms.some(term => normalizeName(name).includes(term)) &&
          !seenUrls.has(href)
        ) {
          results.push({
            name: `${name} (extra)`,
            title: `${name} (extra)`,
            externalUrl: href,
            behaviorHints: { notWebReady: true, external: true }
          });
          seenUrls.add(href);
          encontrados++;
        }
      });

      // Estructura Shickat
      $('.canal-card').each((_, card) => {
        const name = $(card).find('.canal-nombre').text().trim();
        const href = $(card).find('.acestream-link').attr('href');
        if (
          name &&
          href &&
          href.startsWith('acestream://') &&
          searchTerms.some(term => normalizeName(name).includes(term)) &&
          !seenUrls.has(href)
        ) {
          results.push({
            name: `${name} (extra)`,
            title: `${name} (extra)`,
            externalUrl: href,
            behaviorHints: { notWebReady: true, external: true }
          });
          seenUrls.add(href);
          encontrados++;
        }
      });

      console.log(logPrefix, `Coincidencias en ${url}: ${encontrados}`);

      if (encontrados === 0) {
        console.log(logPrefix, `Fallback: añadiendo todos los enlaces de ${url}`);
        $('#linksList li').each((_, li) => {
          const name = $(li).find('.link-name').text().trim();
          const href = $(li).find('.link-url a').attr('href');
          if (name && href && href.startsWith('acestream://') && !seenUrls.has(href)) {
            results.push({
              name: `${name} (extra)`,
              title: `${name} (extra)`,
              externalUrl: href,
              behaviorHints: { notWebReady: true, external: true }
            });
            seenUrls.add(href);
          }
        });

        $('.canal-card').each((_, card) => {
          const name = $(card).find('.canal-nombre').text().trim();
          const href = $(card).find('.acestream-link').attr('href');
          if (name && href && href.startsWith('acestream://') && !seenUrls.has(href)) {
            results.push({
              name: `${name} (extra)`,
              title: `${name} (extra)`,
              externalUrl: href,
              behaviorHints: { notWebReady: true, external: true }
            });
            seenUrls.add(href);
          }
        });
      }
    } catch (e) {
      console.error(logPrefix, `Error en ${url}:`, e.message);
    }
  }

  console.log(logPrefix, `Total streams extra encontrados: ${results.length}`);
  await kvSetJsonTTL(cacheKey, results, ttlSeconds);
  return results;
}

module.exports = { scrapeExtraWebs };
