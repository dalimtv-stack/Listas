// src/eventos/poster-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJson, kvSetJson } = require('../../api/kv');

function normalizeMatchName(matchName) {
  return matchName
    .toLowerCase()
    .replace(/\bvs\b/gi, '-')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateFallbackNames(original, context = '') {
  const normalized = normalizeMatchName(original);
  const variants = [normalized];

  const teamAliases = {
    'atletico de madrid': 'at. madrid',
    'real madrid': 'r. madrid',
    'fc barcelona': 'barça',
    'juventus': 'juve',
    'inter milan': 'inter',
    'ac milan': 'milan',
    'bayern munich': 'bayern',
    'borussia dortmund': 'dortmund',
    'paris saint-germain': 'psg',
    'simulcast': ['multieuropa', 'multichampions'],
    'pekin tournament': 'torneo de pekin',
    'tokyo tournament': 'torneo de tokio'
  };

  let aliasVersion = normalized;

  for (const [full, alias] of Object.entries(teamAliases)) {
    const regex = new RegExp(`\\b${full}\\b`, 'gi');
    if (Array.isArray(alias)) {
      alias.forEach(a => {
        const replaced = aliasVersion.replace(regex, a);
        if (replaced !== aliasVersion) variants.push(replaced);
      });
    } else {
      const replaced = aliasVersion.replace(regex, alias);
      if (replaced !== aliasVersion) variants.push(replaced);
    }
  }

  if (context) {
    const contextNorm = normalizeMatchName(context);
    variants.push(contextNorm);
    if (teamAliases[contextNorm]) {
      const alias = teamAliases[contextNorm];
      if (Array.isArray(alias)) {
        variants.push(...alias.map(normalizeMatchName));
      } else {
        variants.push(normalizeMatchName(alias));
      }
    }
  }

  return [...new Set(variants)];
}

function generatePlaceholdPoster({ hora, deporte, competicion }) {
  const text = `${hora}\n \n${deporte}\n \n${competicion}`;
  return `https://placehold.co/938x1406@3x/999999/80f4eb?text=${encodeURIComponent(text)}&font=poppins&png`;
}

async function scrapePostersForMatches(matches) {
  const results = [];
  const urlToMatches = new Map(); // Agrupa partidos por URL de póster

  for (const match of matches) {
    const { partido, hora, deporte, competicion } = match;
    const finalCacheKey = `posterFinal:${normalizeMatchName(partido)}:${hora}`;
    const finalCached = await kvGetJson(finalCacheKey);

    if (finalCached?.finalUrl?.startsWith('data:image')) {
      results.push({ partido, posterUrl: finalCached.finalUrl });
      console.log(JSON.stringify({
        level: 'info',
        scope: 'poster-events',
        match: partido,
        cached: true,
        status: 'cached-final'
      }));
      continue;
    }

    const movistarCacheKey = `poster:${normalizeMatchName(partido)}`;
    let posterUrl = (await kvGetJson(movistarCacheKey))?.posterUrl;

    if (!posterUrl) {
      try {
        const isTenis = deporte?.toLowerCase() === 'tenis';
        const sourceUrl = isTenis
          ? 'https://www.movistarplus.es/deportes/tenis/donde-ver'
          : 'https://www.movistarplus.es/el-partido-movistarplus';

        const htmlCacheKey = isTenis ? 'movistar_tenis_html' : 'movistar_general_html';
        let htmlCached = await kvGetJson(htmlCacheKey);

        let html;
        if (htmlCached?.html) {
          html = htmlCached.html;
          console.log(JSON.stringify({
            level: 'info',
            scope: 'poster-events',
            match: partido,
            status: 'html-cached'
          }));
        } else {
          const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(5000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          html = await res.text();
          await kvSetJson(htmlCacheKey, { html, createdAt: Date.now() }, { ttl: 3600 });
          console.log(JSON.stringify({
            level: 'info',
            scope: 'poster-events',
            match: partido,
            status: 'html-fetched'
          }));
        }

        const $ = cheerio.load(html);
        const candidates = generateFallbackNames(partido, competicion);

        for (const name of candidates) {
          $('img').each((_, img) => {
            const alt = $(img).attr('alt')?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
            const src = $(img).attr('src')?.toLowerCase() || '';
            if (alt.includes(name) || src.includes(name)) {
              posterUrl = $(img).attr('src');
              return false;
            }
          });
          if (posterUrl) break;
        }

        if (posterUrl?.startsWith('http')) {
          await kvSetJson(movistarCacheKey, { posterUrl, createdAt: Date.now() }, { ttl: 86400 });
        }
      } catch (err) {
        console.error(JSON.stringify({
          level: 'error',
          scope: 'poster-events',
          match: partido,
          error: err.message,
          status: 'scrape-error'
        }));
      }
    }

    if (posterUrl?.startsWith('http')) {
      urlToMatches.set(posterUrl, [
        ...(urlToMatches.get(posterUrl) || []),
        { partido, hora, deporte, competicion }
      ]);
    } else {
      const fallback = generatePlaceholdPoster({ hora, deporte, competicion });
      await kvSetJson(finalCacheKey, { finalUrl: fallback, createdAt: Date.now() }, { ttl: 86400 });
      results.push({ partido, posterUrl: fallback });
      console.log(JSON.stringify({
        level: 'warn',
        scope: 'poster-events',
        match: partido,
        tried: generateFallbackNames(partido, competicion),
        poster: fallback,
        status: 'fallback'
      }));
    }
  }

  if (urlToMatches.size > 0) {
    const posterRequests = Array.from(urlToMatches.entries()).map(([url, matches]) => ({
      url: url + '.png',
      horas: matches.map(m => m.hora)
    }));

    try {
      const response = await fetch('https://listas-sand.vercel.app/poster-con-hora', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posters: posterRequests }),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const transformedPosters = await response.json();

      for (const [url, matches] of urlToMatches) {
        const transformed = transformedPosters.find(p => p.originalUrl === url + '.png');
        if (transformed?.urls) {
          matches.forEach((match, index) => {
            const finalUrl = transformed.urls.find(u => u.hora === match.hora)?.url ||
                             generatePlaceholdPoster({ hora: match.hora, deporte: match.deporte, competicion: match.competicion });
            const finalCacheKey = `posterFinal:${normalizeMatchName(match.partido)}:${match.hora}`;
            kvSetJson(finalCacheKey, { finalUrl, createdAt: Date.now() }, { ttl: 86400 });
            results.push({ partido: match.partido, posterUrl: finalUrl });
            console.log(JSON.stringify({
              level: 'info',
              scope: 'poster-events',
              match: match.partido,
              hora: match.hora,
              status: 'transformed'
            }));
          });
        } else {
          matches.forEach(match => {
            const fallback = generatePlaceholdPoster({ hora: match.hora, deporte: match.deporte, competicion: match.competicion });
            const finalCacheKey = `posterFinal:${normalizeMatchName(match.partido)}:${match.hora}`;
            kvSetJson(finalCacheKey, { finalUrl: fallback, createdAt: Date.now() }, { ttl: 86400 });
            results.push({ partido: match.partido, posterUrl: fallback });
            console.log(JSON.stringify({
              level: 'warn',
              scope: 'poster-events',
              match: match.partido,
              status: 'transformed-fallback'
            }));
          });
        }
      }
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        scope: 'poster-events',
        error: err.message,
        status: 'poster-con-hora-error'
      }));
      for (const [, matches] of urlToMatches) {
        matches.forEach(match => {
          const fallback = generatePlaceholdPoster({ hora: match.hora, deporte: match.deporte, competicion: match.competicion });
          const finalCacheKey = `posterFinal:${normalizeMatchName(match.partido)}:${match.hora}`;
          kvSetJson(finalCacheKey, { finalUrl: fallback, createdAt: Date.now() }, { ttl: 86400 });
          results.push({ partido: match.partido, posterUrl: fallback });
        });
      }
    }
  }

  return results;
}

module.exports = { scrapePostersForMatches };
