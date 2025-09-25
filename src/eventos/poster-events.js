// src/eventos/poster-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJson, kvSetJson } = require('../../api/kv');

// Normaliza nombres de partidos para matching
function normalizeMatchName(matchName) {
  return matchName
    .toLowerCase()
    .replace(/\bvs\b/gi, '-')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Genera variantes abreviadas para fallback
function generateFallbackNames(original, context = '') {
  const normalized = normalizeMatchName(original);
  const variants = [normalized];

  const teamAliases = {
    'atletico de madrid': 'at. madrid',
    'real madrid': 'r. madrid',
    'real sociedad': 'r. sociedad',
    'fc barcelona': 'barça',
    'rayo vallecano': 'rayo',
    'deportivo alaves': 'alaves',
    'cadiz': 'cádiz',
    'real oviedo': 'oviedo',
    'celta de vigo': 'celta',
    'athletic club': 'athletic',
    'manchester united': 'man united',
    'manchester city': 'man city',
    'tottenham hotspur': 'spurs',
    'newcastle united': 'newcastle',
    'west ham united': 'west ham',
    'brighton & hove albion': 'brighton',
    'aston villa': 'villa',
    'crystal palace': 'palace',
    'wolverhampton wanderers': 'wolves',
    'nottingham forest': 'forest',
    'sheffield united': 'sheffield',
    'luton town': 'luton',
    'juventus': 'juve',
    'inter milan': 'inter',
    'ac milan': 'milan',
    'bayern munich': 'bayern',
    'borussia dortmund': 'dortmund',
    'rb leipzig': 'leipzig',
    'bayer leverkusen': 'leverkusen',
    'borussia monchengladbach': 'gladbach',
    'eintracht frankfurt': 'frankfurt',
    'vfl wolfsburg': 'wolfsburg',
    'fc koln': 'cologne',
    'werder bremen': 'bremen',
    'fc augsburg': 'augsburg',
    'union berlin': 'union',
    'paris saint-germain': 'psg',
    'olympique lyonnais': 'lyon',
    'olympique de marseille': 'marseille',
    'as monaco': 'monaco',
    'rc lens': 'lens',
    'al akhdoud': 'al okhdood',
    'bologna': 'bolonia',
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

async function scrapePosterForMatch({ partido, hora, deporte, competicion }) {
  const cacheKey = `poster:${normalizeMatchName(partido)}`;
  const cached = await kvGetJson(cacheKey);

  if (cached?.posterUrl && cached.posterUrl.startsWith('http')) {
    return { partido, hora, deporte, competicion, posterUrl: cached.posterUrl };
  }

  try {
    const isTenis = deporte?.toLowerCase() === 'tenis';
    const sourceUrl = isTenis
      ? 'https://www.movistarplus.es/deportes/tenis/donde-ver'
      : 'https://www.movistarplus.es/el-partido-movistarplus';

    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const candidates = generateFallbackNames(partido, competicion);
    let posterUrl = null;

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

    if (posterUrl && posterUrl.startsWith('http')) {
      await kvSetJson(cacheKey, { posterUrl, createdAt: Date.now() }, { ttl: 24 * 60 * 60 });
      return { partido, hora, deporte, competicion, posterUrl };
    } else {
      const fallback = generatePlaceholdPoster({ hora, deporte, competicion });
      return { partido, hora, deporte, competicion, posterUrl: fallback };
    }
  } catch (err) {
    const fallback = generatePlaceholdPoster({ hora, deporte, competicion });
    return { partido, hora, deporte, competicion, posterUrl: fallback };
  }
}

// FIX APLICADO: agrupación y generación por lote
async function generarPostersAgrupados(partidos) {
  const agrupados = {};
  for (const p of partidos) {
    const { partido, hora, deporte, competicion } = p;
    const resultado = await scrapePosterForMatch({ partido, hora, deporte, competicion });
    const posterUrl = resultado.posterUrl;
    if (!agrupados[posterUrl]) agrupados[posterUrl] = [];
    agrupados[posterUrl].push({ partido, hora, deporte, competicion });
  }

  const resultadosFinales = [];

  for (const [posterUrl, variantes] of Object.entries(agrupados)) {
    const horas = variantes.map(v => v.hora);
    const endpoint = `https://listas-sand.vercel.app/poster-con-hora?url=${encodeURIComponent(posterUrl)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horas })
    });

    const posters = await res.json(); // [{ hora, url }]
    for (const { hora, url } of posters) {
      const partido = variantes.find(v => v.hora === hora)?.partido;
      const deporte = variantes.find(v => v.hora === hora)?.deporte;
      const competicion = variantes.find(v => v.hora === hora)?.competicion;

      resultadosFinales.push({ partido, hora, deporte, competicion, poster: url });
    }
  }

  return resultadosFinales;
}

module.exports = { scrapePosterForMatch, generarPostersAgrupados };
