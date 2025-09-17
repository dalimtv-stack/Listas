'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJsonTTL, kvSetJsonTTL } = require('./kv');

const channelAliases = {
  'movistar laliga (fhd)': ['m. laliga', 'm. laliga 1080p', 'movistar laliga'],
  'dazn f1 (fhd)': ['dazn f1', 'dazn f1 1080', 'dazn f1 1080  (fórmula 1)', 'fórmula 1'],
  'primera federacion "rfef" (fhd)': ['rfef', 'primera federacion', 'primera federación', '1rfef', 'canal 1 [1rfef]'],
  'movistar plus (1080)': ['movistar plus', 'm. plus', 'movistar plus fhd', 'movistar+', 'plus fhd'],
  'canal 1 [1rfef] (solo eventos)': ['primera federacion', 'primera federacion "rfef"', '1rfef', 'primera federacion rfef', 'canal 1 [1rfef]']
};

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(.*?\)/g, '') // Elimina contenido entre paréntesis
    .replace(/\[.*?\]/g, '')   // Elimina contenido entre corchetes
    .trim();
}

function getSearchTerms(channelName) {
  const original = String(channelName || '').toLowerCase();
  const normalized = normalizeName(channelName);
  const aliases = channelAliases[normalized] || channelAliases[original] || [];
  return [...new Set([normalized, original, ...aliases])];
}

function normalizeUrlForDisplay(url) {
  return String(url || '')
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/+$/, '');
}

function isNumberMismatch(streamName, channelName) {
  const streamNums = normalizeName(streamName).match(/\b\d+\b/g) || [];
  const channelNums = normalizeName(channelName).match(/\b\d+\b/g) || [];
  if (channelNums.length === 0) return false; // Permitir streams sin números si el canal no los tiene
  return !streamNums.some(n => channelNums.includes(n));
}

function isMatch(normalizedName, searchTerms, channelName) {
  const isChannel1 = normalizeName(channelName).includes('canal 1 [1rfef]');
  return searchTerms.some(term => {
    const baseTerm = normalizeName(term);
    const baseName = normalizeName(normalizedName);
    const baseMatch = baseName.includes(baseTerm) || baseTerm.includes(baseName);
    const rfefMatch = (baseName.includes('1rfef') && baseTerm.includes('rfef')) ||
                     (baseTerm.includes('1rfef') && baseName.includes('rfef'));
    return (baseMatch || (rfefMatch && isChannel1));
  });
}

async function scrapeExtraWebs(channelName, extraWebsList) {
  const logPrefix = '[SCRAPER]';
  if (!channelName || typeof channelName !== 'string') {
    console.warn(logPrefix, 'Nombre de canal no definido o inválido');
    return [];
  }

  const normalizedTarget = normalizeName(channelName);
  const cacheKey = `scrape:${normalizedTarget}`;
  const ttlSeconds = 3600; // Aumentado a 1 hora; ajusta si los cambios en las webs son más frecuentes

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
  const searchTerms = getSearchTerms(channelName);

  for (const url of extraWebsList) {
    try {
      console.log(logPrefix, `Fetch -> ${url}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} - ${response.statusText}`);
      const html = await response.text();
      clearTimeout(timeoutId);

      const $ = cheerio.load(html);
      let encontrados = 0;

      $('#linksList li').each((_, li) => {
        const name = $(li).find('.link-name').text().trim();
        const href = $(li).find('.link-url a').attr('href');
        const normalizedName = normalizeName(name);
        if (
          name &&
          href &&
          href.startsWith('acestream://') &&
          isMatch(normalizedName, searchTerms, channelName) &&
          !isNumberMismatch(name, channelName) &&
          !seenUrls.has(href)
        ) {
          const displayName = normalizeUrlForDisplay(url);
          const stream = {
            name: displayName,
            title: `${name} (Acestream)`,
            externalUrl: href,
            group_title: displayName,
            behaviorHints: { notWebReady: true, external: true }
          };
          results.push(stream);
          seenUrls.add(href);
          encontrados++;
          console.log(logPrefix, `Stream añadido: ${JSON.stringify(stream)}`);
        }
      });

      $('.canal-card').each((_, card) => {
        const name = $(card).find('.canal-nombre').text().trim();
        const href = $(card).find('.acestream-link').attr('href');
        const normalizedName = normalizeName(name);
        if (
          name &&
          href &&
          href.startsWith('acestream://') &&
          isMatch(normalizedName, searchTerms, channelName) &&
          !isNumberMismatch(name, channelName) &&
          !seenUrls.has(href)
        ) {
          const displayName = normalizeUrlForDisplay(url);
          const stream = {
            name: displayName,
            title: `${name} (Acestream)`,
            externalUrl: href,
            group_title: displayName,
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
      if (e.name === 'AbortError') {
        console.warn(logPrefix, `Timeout de 8s alcanzado en ${url}`);
      }
    }
  }

  console.log(logPrefix, `Total streams extra encontrados: ${results.length}`);
  if (results.length > 0) {
    // Verificar si los resultados han cambiado antes de escribir
    const hasChanged = !cached || !arraysEqual(cached, results, (a, b) => a.externalUrl === b.externalUrl);
    if (hasChanged) {
      await kvSetJsonTTL(cacheKey, results, ttlSeconds);
      console.log(logPrefix, `Cache actualizado para "${normalizedTarget}" con ${results.length} streams`);
    } else {
      console.log(logPrefix, `No hay cambios en los streams, cache no actualizado para "${normalizedTarget}"`);
    }
  }
  return results;
}

// Función auxiliar para comparar arrays de objetos
function arraysEqual(arr1, arr2, compareFn) {
  if (arr1.length !== arr2.length) return false;
  return arr1.every((item, index) => compareFn(item, arr2[index]));
}

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(.*?\)/g, '') // Elimina contenido entre paréntesis
    .replace(/\[.*?\]/g, '')   // Elimina contenido entre corchetes
    .trim();
}

function getSearchTerms(channelName) {
  const original = String(channelName || '').toLowerCase();
  const normalized = normalizeName(channelName);
  const aliases = channelAliases[normalized] || channelAliases[original] || [];
  return [...new Set([normalized, original, ...aliases])];
}

function normalizeUrlForDisplay(url) {
  return String(url || '')
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/+$/, '');
}

function isNumberMismatch(streamName, channelName) {
  const streamNums = normalizeName(streamName).match(/\b\d+\b/g) || [];
  const channelNums = normalizeName(channelName).match(/\b\d+\b/g) || [];
  if (channelNums.length === 0) return false; // Permitir streams sin números si el canal no los tiene
  return !streamNums.some(n => channelNums.includes(n));
}

function isMatch(normalizedName, searchTerms, channelName) {
  const isChannel1 = normalizeName(channelName).includes('canal 1 [1rfef]');
  return searchTerms.some(term => {
    const baseTerm = normalizeName(term);
    const baseName = normalizeName(normalizedName);
    const baseMatch = baseName.includes(baseTerm) || baseTerm.includes(baseName);
    const rfefMatch = (baseName.includes('1rfef') && baseTerm.includes('rfef')) ||
                     (baseTerm.includes('1rfef') && baseName.includes('rfef'));
    return (baseMatch || (rfefMatch && isChannel1));
  });
}

module.exports = { scrapeExtraWebs };
