// api/scraper.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { parse } = require('iptv-playlist-parser');
const { kvGetJsonTTL, kvSetJsonTTL, kvDelete } = require('./kv');

const channelAliases = {
  'movistar plus': ['movistar plus', 'movistarplus', 'm. plus', 'm+ plus', 'm+plus', 'movistar plus fhd', 'movistar+', 'plus fhd', 'movistarplus 1080', 'movistar plus 1080'],
  'movistar laliga (fhd)': ['m. laliga', 'm. laliga 1080p', 'movistar laliga'],
  'dazn f1': ['dazn f1', 'dazn f1 1080', 'dazn f1 1080 (fórmula 1)', 'fórmula 1', 'dazn f1 es'],
  'primera federacion "rfef" (fhd)': ['rfef', 'primera federacion', 'primera federación', '1rfef', 'canal 1 [1rfef]'],
  'canal 1 [1rfef] (solo eventos)': ['primera federacion', 'primera federacion "rfef"', '1rfef', 'primera federacion rfef', 'canal 1 [1rfef]'],
  'dazn f1 (1080)': ['dazn f1 es', 'dazn f1 [es]'],
  'laliga hypermotion': ['laliga tv hypermotion']
};

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getSearchTerms(channelName) {
  const original = String(channelName || '').toLowerCase();
  const normalized = normalizeName(channelName)
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/\[.*?\]/g, '');
  const aliases = channelAliases[normalized] || channelAliases[original] || [];
  const terms = [...new Set([normalized, original, ...aliases])];
  // console.log('[SCRAPER] Términos de búsqueda generados para', channelName, ':', terms);
  return terms;
}

function normalizeUrlForDisplay(url) {
  return String(url || '')
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/+$/, '');
}

function isNumberMismatch(streamName, channelName) {
  const streamNums = normalizeName(streamName).match(/\b\d+\b/g) || [];
  const channelNums = normalizeName(channelName).match(/\b\d+\b/g) || [];

  console.log('[SCRAPER] isNumberMismatch:', {
    streamName,
    channelName,
    streamNums,
    channelNums
  });

  // Ignorar indicadores de calidad como 1080, 720, 2160
  const qualityIndicators = ['1080', '720', '2160'];
  const filteredStreamNums = streamNums.filter(n => !qualityIndicators.includes(n));
  const filteredChannelNums = channelNums.filter(n => !qualityIndicators.includes(n));

  console.log('[SCRAPER] isNumberMismatch post-filter:', {
    filteredStreamNums,
    filteredChannelNums
  });

  // Si el canal tiene números (como "2", "3") y el stream no, es mismatch
  if (filteredChannelNums.length > 0 && filteredStreamNums.length === 0) {
    console.log('[SCRAPER] numberMismatch=true: canal tiene números pero el stream no');
    return true;
  }

  // Si hay números en ambos pero no coinciden, también es mismatch
  const mismatch = filteredStreamNums.some(n => !filteredChannelNums.includes(n));
  console.log('[SCRAPER] isNumberMismatch result:', mismatch);
  return mismatch;
}

function isMatch(normalizedName, searchTerms, channelName) {
  const isChannel1 = normalizeName(channelName).includes('canal 1 [1rfef]');
  const match = searchTerms.some(term => {
    const baseTerm = normalizeName(term);
    const baseName = normalizeName(normalizedName);
    const baseMatch = baseName.includes(baseTerm) || baseTerm.includes(baseName);
    const rfefMatch = (baseName.includes('1rfef') && baseTerm.includes('rfef')) ||
                     (baseTerm.includes('1rfef') && baseName.includes('rfef'));
    const movistarMatch = baseName.includes('movistarplus') && baseTerm.includes('movistar plus');
    return (baseMatch || rfefMatch || movistarMatch) && (isChannel1 ? rfefMatch : true);
  });
  // console.log('[SCRAPER] isMatch:', { normalizedName, channelName, match });
  return match;
}

async function scrapeExtraWebs(channelName, extraWebsList, forceScrape = false) {
  const logPrefix = '[SCRAPER]';
  if (!channelName || typeof channelName !== 'string') {
    console.warn(logPrefix, 'Nombre de canal no definido o inválido');
    return [];
  }

  const normalizedTarget = normalizeName(channelName);
  const cacheKey = `scrape:${normalizedTarget}`;
  const ttlSeconds = 3600;

  let cached = null;
  if (!forceScrape) {
    cached = await kvGetJsonTTL(cacheKey);
    if (cached) {
      console.log(logPrefix, `Usando cache (${cached.length} resultados) para "${normalizedTarget}"`);
      return cached;
    }
  } else {
    console.log(logPrefix, `Forzando scrapeo para "${normalizedTarget}", limpiando caché`);
    await kvDelete(cacheKey);
  }

  console.log(logPrefix, `Iniciado para canal: ${channelName}, forceScrape: ${forceScrape}`);
  console.log(logPrefix, `Nombre normalizado: "${normalizedTarget}"`);
  console.log(logPrefix, `Lista de webs a scrapear:`, extraWebsList);

  const results = [];
  const seenUrls = new Set();
  const searchTerms = getSearchTerms(channelName);

  for (const url of extraWebsList) {
    try {
      // console.log(logPrefix, `Fetch -> ${url}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const content = await response.text();
      clearTimeout(timeoutId);

      console.log(logPrefix, `Contenido recibido de ${url}, longitud: ${content.length}`);

      // Procesar como M3U si la URL termina en .m3u o el contenido parece una lista M3U
      if (url.endsWith('.m3u') || content.startsWith('#EXTM3U')) {
        // console.log(logPrefix, `Detectado contenido M3U en ${url}`);
        let playlist;
        try {
          playlist = parse(content);
        } catch (err) {
          console.error(logPrefix, `Error parseando M3U desde ${url}: ${err.message}`);
          continue;
        }
        // console.log(logPrefix, `M3U parseado, items: ${playlist.items.length}`);
      
        playlist.items.forEach((item, index) => {
          const name = item.name || '';
          const href = item.url;
          let groupTitle = item.tvg.group || '';
      
          // Extraer manualmente group-title si el parser no lo hizo
          if (!groupTitle && item.raw) {
            const match = item.raw.match(/group-title="([^"]+)"/);
            if (match) groupTitle = match[1];
          }
      
          const normalizedName = normalizeName(name);
          const matchResult = isMatch(normalizedName, searchTerms, channelName);
          const numberMismatch = isNumberMismatch(name, channelName);
      
          // console.log(logPrefix, `Evaluando M3U: name="${name}", href="${href}", groupTitle="${groupTitle}", isMatch=${matchResult}, numberMismatch=${numberMismatch}`);
      
          if (
            name &&
            href &&
            href.endsWith('.m3u8') &&
            groupTitle === 'SPAIN' &&
            matchResult &&
            !numberMismatch &&
            !seenUrls.has(href)
          ) {
            const displayName = normalizeUrlForDisplay(url);
            const stream = {
              name: displayName,
              title: `${name} (M3U8)`,
              url: href,
              group_title: displayName,
              behaviorHints: { notWebReady: false, external: false }
            };
            results.push(stream);
            seenUrls.add(href);
            console.log(logPrefix, `Stream M3U8 añadido: ${JSON.stringify(stream)}`);
          } else {
            console.log(logPrefix, `Descartado M3U: name="${name}", href="${href}", groupTitle="${groupTitle}", isMatch=${matchResult}, numberMismatch=${numberMismatch}`);
          }
        });
        continue;
      }
      
      // Procesar HTML con Cheerio
      const $ = cheerio.load(content);
      let encontrados = 0;

      // Selector para shickat.me u otros (solo acestream://)
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
        } else {
          console.log(logPrefix, `Descartado shickat.me: name="${name}", href="${href}", isMatch=${isMatch(normalizedName, searchTerms, channelName)}, numberMismatch=${isNumberMismatch(name, channelName)}`);
        }
      });

      // Selector para canal-card (solo acestream://)
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
        } else {
          console.log(logPrefix, `Descartado canal-card: name="${name}", href="${href}", isMatch=${isMatch(normalizedName, searchTerms, channelName)}, numberMismatch=${isNumberMismatch(name, channelName)}`);
        }
      });

      // Selector para elcano.top - extrae JSON de linksData (solo acestream://)
      if (url.includes('elcano.top')) {
        console.log(logPrefix, 'Detectado elcano.top, extrayendo JSON de linksData');
        const scriptText = $('script').filter((i, el) => $(el).html().includes('linksData')).html();
        if (scriptText) {
          console.log(logPrefix, `Script encontrado, longitud: ${scriptText.length}`);
          const linksDataMatch = scriptText.match(/const linksData = ({.*?});/s);
          if (linksDataMatch) {
            try {
              const linksData = JSON.parse(linksDataMatch[1]);
              console.log(logPrefix, `linksData parseado: ${JSON.stringify(linksData)}`);
              if (linksData.links && Array.isArray(linksData.links)) {
                linksData.links.forEach(link => {
                  const name = link.name;
                  const href = link.url;
                  const normalizedName = normalizeName(name);
                  if (
                    name &&
                    href &&
                    href.startsWith('acestream://') &&
                    isMatch(normalizedName, searchTerms, channelName) &&
                    !isNumberMismatch(name, channelName) &&
                    !seenUrls.has(href)
                  ) {
                    const displayName = 'elcano.top';
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
                    console.log(logPrefix, `Stream añadido desde linksData (elcano): ${JSON.stringify(stream)}`);
                  } else {
                    console.log(logPrefix, `Descartado elcano.top: name="${name}", href="${href}", isMatch=${isMatch(normalizedName, searchTerms, channelName)}, numberMismatch=${isNumberMismatch(name, channelName)}`);
                  }
                });
              } else {
                console.log(logPrefix, 'linksData.links no es un array o no existe');
              }
            } catch (parseErr) {
              console.error(logPrefix, 'Error parseando linksData JSON:', parseErr.message);
            }
          } else {
            console.log(logPrefix, 'No se encontró linksData en el script de elcano.top');
          }
        } else {
          console.log(logPrefix, 'No se encontró script con linksData en elcano.top');
        }
      }

      console.log(logPrefix, `Coincidencias en ${url}: ${encontrados}`);
    } catch (e) {
      console.error(logPrefix, `Error en ${url}:`, e.message);
    }
  }

  console.log(logPrefix, `Total streams extra encontrados: ${results.length}`);
  if (results.length > 0) {
    const hasChanged = !cached || !arraysEqual(cached || [], results, (a, b) => a.url === b.url || a.externalUrl === b.externalUrl);
    if (hasChanged) {
      await kvSetJsonTTL(cacheKey, results, ttlSeconds);
      console.log(logPrefix, `Cache actualizado para "${normalizedTarget}" con ${results.length} streams`);
    } else {
      console.log(logPrefix, `No hay cambios en los streams, cache no actualizado para "${normalizedTarget}"`);
    }
  }
  return results;
}

function arraysEqual(arr1, arr2, compareFn) {
  if (arr1.length !== arr2.length) return false;
  return arr1.every((item, index) => compareFn(item, arr2[index]));
}

module.exports = { scrapeExtraWebs };
