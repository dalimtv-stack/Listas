// api/scraper.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { parse } = require('iptv-playlist-parser');
const { kvGetJsonTTL, kvSetJsonTTLIfChanged, kvDelete } = require('./kv');

const channelAliases = {
  'movistar plus': ['movistar plus', 'movistarplus', 'm. plus', 'm+ plus', 'm+plus', 'movistar plus fhd', 'movistar+', 'plus fhd', 'movistarplus 1080', 'movistar plus 1080'],
  'movistar laliga (fhd)': ['m. laliga', 'm. laliga 1080p', 'movistar laliga'],
  'dazn f1': ['dazn f1', 'dazn f1 1080', 'dazn f1 1080 (fórmula 1)', 'fórmula 1', 'dazn f1 es'],
  'primera federacion "rfef" (fhd)': ['rfef', 'primera federacion', 'primera federación', '1rfef', 'canal 1 [1rfef]'],
  'canal 1 [1rfef] (solo eventos)': ['primera federacion', 'primera federacion "rfef"', '1rfef', 'primera federacion rfef', 'canal 1 [1rfef]'],
  'dazn f1 (1080)': ['dazn f1 es', 'dazn f1 [es]'],
  'laliga hypermotion': ['laliga tv hypermotion'],
  'movistar ellas vamos': ['ellas vamos spain'],
  'movistar vamos': ['vamos spain, movistar vamos, vamos']
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
  return terms;
}

function normalizeUrlForDisplay(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'raw.githubusercontent.com') {
      const parts = parsed.pathname.split('/');
      const repo = parts[2] || 'github';
      return `Github:${repo}`;
    }
    if (host.includes('ipfs.io')) return 'elcano.top';
    return host;
  } catch (e) {
    return String(url || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  }
}

function isNumberMismatch(streamName, channelName) {
  const streamNums = normalizeName(streamName).match(/\b\d+\b/g) || [];
  const channelNums = normalizeName(channelName).match(/\b\d+\b/g) || [];
  const qualityIndicators = ['1080', '720', '2160'];
  const filteredStreamNums = streamNums.filter(n => !qualityIndicators.includes(n));
  const filteredChannelNums = channelNums.filter(n => !qualityIndicators.includes(n));
  if (filteredChannelNums.length > 0 && filteredStreamNums.length === 0) return true;
  return filteredStreamNums.some(n => !filteredChannelNums.includes(n));
}

function isMatch(normalizedName, searchTerms, channelName) {
  const baseChannel = normalizeName(channelName).replace(/\(.*?\)/g, '').trim();
  const baseStream = normalizeName(normalizedName).replace(/\(.*?\)/g, '').trim();

  // 🛡️ Reglas defensivas
  if (baseChannel.includes('ellas') && !baseStream.includes('ellas')) return false;
  if (baseChannel.includes('rfef') && !baseStream.includes('rfef') && !baseStream.includes('1rfef')) return false;
  if (baseChannel.includes('f1') && !baseStream.includes('f1')) return false;

  // Coincidencia fuerte por sufijos conocidos
  const suffixMatch = /

\[(.*?)\]

$/.exec(normalizedName);
  if (suffixMatch) {
    const suffix = normalizeName(suffixMatch[1]);
    if (!baseChannel.includes(suffix) && !suffix.includes(baseChannel)) return false;
  }

  // Coincidencia por alias
  return searchTerms.some(term => {
    const baseTerm = normalizeName(term);
    return baseStream.includes(baseTerm) || baseTerm.includes(baseStream);
  });
}

async function scrapeExtraWebs(channelName, extraWebsList, forceScrape = false) {
  const logPrefix = '[SCRAPER]';
  if (!channelName || typeof channelName !== 'string') return [];

  const normalizedTarget = normalizeName(channelName);
  const cacheKey = `scrape:${normalizedTarget}`;
  const ttlSeconds = 3600;

  let cached = null;
  if (!forceScrape) {
    cached = await kvGetJsonTTL(cacheKey);
    if (cached) return cached;
  } else {
    await kvDelete(cacheKey);
  }

  const results = [];
  const vlcResults = []; // acumulamos VLC aquí
  const seenUrls = new Set();
  const searchTerms = getSearchTerms(channelName);

  for (const url of extraWebsList) {
    let content;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        content = await response.text();
      } finally {
        clearTimeout(timeoutId);
      }

      if (url.endsWith('.m3u') || content.startsWith('#EXTM3U')) {
        let playlist;
        try {
          playlist = parse(content);
        } catch {
          continue;
        }
        playlist.items.forEach(item => {
          const rawName = item.name || '';
          const name = rawName.startsWith('#') ? rawName.slice(1).trim() : rawName.trim();
          const href = item.url;
          let groupTitle = item.tvg.group || '';
          if (!groupTitle && item.raw) {
            const match = item.raw.match(/group-title="([^"]+)"/);
            if (match) groupTitle = match[1];
          }
          const normalizedName = normalizeName(name);
          const matchResult = isMatch(normalizedName, searchTerms, channelName);
          const numberMismatch = isNumberMismatch(name, channelName);
          if (name && href && href.endsWith('.m3u8') && groupTitle === 'SPAIN' && matchResult && !numberMismatch && !seenUrls.has(href)) {
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
          }
        });
        continue;
      }

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

          // 🚀 Alternativa VLC
          const aceId = href.replace('acestream://', '');
          const vlcUrl = `http://vlc.shickat.me:8000/pid/${aceId}/stream.mp4`;
          if (!seenUrls.has(vlcUrl)) {
            const vlcStream = {
              name: 'VLC',
              title: `${name} (VLC)`,
              url: vlcUrl,
              group_title: 'VLC',
              behaviorHints: { notWebReady: false, external: false }
            };
            // Guardas de integridad (diagnóstico)
            if (vlcStream.externalUrl || vlcStream.acestream_id) {
              console.warn('[SCRAPER] [ALERTA] vlcStream trae campos de Ace (NO DEBE):', vlcStream);
            }
            // Normaliza explícitamente por si alguna mutación externa lo ensucia
            delete vlcStream.externalUrl;
            delete vlcStream.acestream_id;
            
            vlcResults.push(vlcStream);
            seenUrls.add(vlcUrl);
          }
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

          // 🚀 Alternativa VLC
          const aceId = href.replace('acestream://', '');
          const vlcUrl = `http://vlc.shickat.me:8000/pid/${aceId}/stream.mp4`;
          if (!seenUrls.has(vlcUrl)) {
            const vlcStream = {
              name: 'VLC',
              title: `${name} (VLC)`,
              url: vlcUrl,
              group_title: 'VLC',
              behaviorHints: { notWebReady: false, external: false }
            };
            // Guardas de integridad (diagnóstico)
            if (vlcStream.externalUrl || vlcStream.acestream_id) {
              console.warn('[SCRAPER] [ALERTA] vlcStream trae campos de Ace (NO DEBE):', vlcStream);
            }
            // Normaliza explícitamente por si alguna mutación externa lo ensucia
            delete vlcStream.externalUrl;
            delete vlcStream.acestream_id;
            
            vlcResults.push(vlcStream);
            seenUrls.add(vlcUrl);
          }
        }
      });

      // Selector para elcano.top - extrae JSON de linksData (solo acestream://)
      if (url.includes('elcano.top')) {
        const scriptText = $('script').filter((i, el) => $(el).html().includes('linksData')).html();
        if (scriptText) {
          const linksDataMatch = scriptText.match(/const linksData = ({.*?});/s);
          if (linksDataMatch) {
            try {
              const linksData = JSON.parse(linksDataMatch[1]);
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

                    // 🚀 Alternativa VLC
                    const aceId = href.replace('acestream://', '');
                    const vlcUrl = `http://vlc.shickat.me:8000/pid/${aceId}/stream.mp4`;
                    if (!seenUrls.has(vlcUrl)) {
                      const vlcStream = {
                        name: 'VLC',
                        title: `${name} (VLC)`,
                        url: vlcUrl,
                        group_title: 'VLC',
                        behaviorHints: { notWebReady: false, external: false }
                      };
                      // Guardas de integridad (diagnóstico)
                      if (vlcStream.externalUrl || vlcStream.acestream_id) {
                        console.warn('[SCRAPER] [ALERTA] vlcStream trae campos de Ace (NO DEBE):', vlcStream);
                      }
                      // Normaliza explícitamente por si alguna mutación externa lo ensucia
                      delete vlcStream.externalUrl;
                      delete vlcStream.acestream_id;
                      
                      vlcResults.push(vlcStream);
                      seenUrls.add(vlcUrl);
                    }
                  }
                });
              }
            } catch {}
          }
        }
      }
    } catch (e) {
      console.error(logPrefix, `Error en ${url}:`, e.message);
    }
  }

  // 🚀 Devolver primero VLC y luego el resto
  const finalResults = [...vlcResults, ...results];

  if (finalResults.length > 0) {
    await kvSetJsonTTLIfChanged(cacheKey, finalResults, ttlSeconds);
  }

  return finalResults;
}

module.exports = { scrapeExtraWebs };
