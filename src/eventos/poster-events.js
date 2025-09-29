// src/eventos/poster-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { kvGetJson, kvSetJsonTTLIfChanged } = require('../../api/kv');

function normalizeMatchName(matchName) {
  return matchName
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Valida que la URL apunta al Blob público del proyecto y a la carpeta "posters"
function isBlobPosterUrl(url) {
  if (typeof url !== 'string') return false;
  const base = process.env.BLOB_PUBLIC_BASE_URL || '';
  if (!base || !base.startsWith('https://') || !base.includes('.public.blob.vercel-storage.com')) return false;
  const startsOk = url.startsWith(base) && url.includes('/posters/');
  const extOk = url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg');
  return startsOk && extOk;
}

// Deriva el nombre de archivo en Blob a partir del ID de la imagen de Movistar y la hora
// Ejemplos de IDs desde tus logs/catalog: F4417838 → "f4417838", e27e6e1d530ce966af6a5197bb2865d1 → se usa tal cual
function deriveBlobPosterUrlFromSource(sourceUrl, hora) {
  const base = process.env.BLOB_PUBLIC_BASE_URL;
  if (!base) return null;

  // Hora en formato "HH_MM"
  const horaSafe = String(hora).trim().replace(':', '_');

  // ID de recorte en la URL de Movistar (último segmento tras la barra)
  // Casos observados: .../F4417838 | .../MESPP4130179 | .../e27e6e1d530ce966af6a5197bb2865d1
  const match = String(sourceUrl).match(/\/([A-Za-z0-9]+)$/);
  if (!match) return null;
  const id = match[1].toLowerCase();

  // Construye la URL final
  return `${base}/posters/${id}_${horaSafe}.png`;
}

function generateFallbackPoster({ hora }) {
  return `https://dummyimage.com/300x450/000/fff&text=${encodeURIComponent(hora)}`;
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

async function buscarPosterEnFuente(url, candidates) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    for (const name of candidates) {
      const nameRegex = new RegExp(name.replace(/[-]/g, '[ -]'), 'i');
      let encontrado = null;

      $('img').each((_, img) => {
        const alt = $(img).attr('alt')?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
        const src = $(img).attr('src')?.toLowerCase() || '';
        if (nameRegex.test(alt) || nameRegex.test(src)) {
          encontrado = $(img).attr('src');
          return false;
        }
      });

      if (encontrado?.startsWith('http')) {
        console.info(`[Poster] Coincidencia encontrada en ${url} → ${encontrado}`);
        return encontrado;
      }
    }
  } catch (err) {
    console.warn(`[Poster] Fallo al buscar en ${url}: ${err.message}`);
  }

  return null;
}

async function headExists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

async function scrapePosterForMatch({ partido, hora, deporte, competicion }) {
  const partidoNorm = normalizeMatchName(partido);

  // 1) KV global del día
  const postersHoy = (await kvGetJson('postersBlobHoy')) || {};
  if (isBlobPosterUrl(postersHoy[partidoNorm])) {
    console.info(`[Poster] Recuperado desde postersBlobHoy: ${partidoNorm}`);
    return postersHoy[partidoNorm];
  }

  // 2) Scraping de fuente original
  let posterSourceUrl;
  try {
    const isTenis = deporte?.toLowerCase() === 'tenis';
    const candidates = generateFallbackNames(partido, competicion);
    const fuentes = isTenis
      ? [
          'https://www.movistarplus.es/deportes/tenis/donde-ver',
          'https://www.movistarplus.es/deportes?conf=iptv',
          'https://www.movistarplus.es/el-partido-movistarplus'
        ]
      : [
          'https://www.movistarplus.es/deportes?conf=iptv',
          'https://www.movistarplus.es/el-partido-movistarplus'
        ];

    for (const fuente of fuentes) {
      posterSourceUrl = await buscarPosterEnFuente(fuente, candidates);
      if (posterSourceUrl) break;
    }

    // Cache auxiliar del scrapeo (no crítica, puede ayudar si luego falta Blob)
    if (posterSourceUrl?.startsWith('http')) {
      const movistarCacheKey = `poster:${partidoNorm}`;
      await kvSetJsonTTLIfChanged(movistarCacheKey, { posterUrl: posterSourceUrl, createdAt: Date.now() }, 86400);
    }
  } catch (err) {
    console.error('[Poster] Error scraping:', err.message);
  }

  if (!posterSourceUrl?.startsWith('http')) {
    console.warn('[Poster] No se encontró póster válido de fuente, devolviendo fallback (no se cachea)');
    return generateFallbackPoster({ hora });
  }

  // 3) Derivar URL esperada en Blob y verificar con HEAD
  const derivedBlobUrl = deriveBlobPosterUrlFromSource(posterSourceUrl, hora);
  if (derivedBlobUrl && isBlobPosterUrl(derivedBlobUrl)) {
    const exists = await headExists(derivedBlobUrl);
    if (exists) {
      const actualizado = { ...postersHoy, [partidoNorm]: derivedBlobUrl };
      await kvSetJsonTTLIfChanged('postersBlobHoy', actualizado, 86400);
      console.info(`[Poster] Encontrado en Blob por HEAD y guardado en KV: ${partidoNorm} → ${derivedBlobUrl}`);
      return derivedBlobUrl;
    }
    console.info(`[Poster] No existe aún en Blob (HEAD 404): ${derivedBlobUrl}`);
  } else {
    console.warn('[Poster] No se pudo derivar URL de Blob válida; se intentará generación con hora');
  }

  // 4) Generación con hora (API interna) SOLO si no existe en Blob
  const endpoint = `https://listas-sand.vercel.app/poster-con-hora?url=${encodeURIComponent(posterSourceUrl)}`;
  let generados;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horas: [hora] })
    });
    generados = await res.json();
  } catch (err) {
    console.error('[Poster] Error al generar con hora:', err.message);
    return generateFallbackPoster({ hora });
  }

  if (!Array.isArray(generados)) {
    console.error('[Poster] Respuesta inválida de poster-con-hora:', generados);
    return generateFallbackPoster({ hora });
  }

  const generado = generados.find(p => p.hora === hora);
  const finalUrl = generado?.url;

  // 5) Guardar en KV solo si es URL válida de Blob; nunca guardar fallback
  if (isBlobPosterUrl(finalUrl)) {
    const actualizado = { ...postersHoy, [partidoNorm]: finalUrl };
    await kvSetJsonTTLIfChanged('postersBlobHoy', actualizado, 86400);
    console.info(`[Poster] Generado y guardado en postersBlobHoy: ${partidoNorm} → ${finalUrl}`);
    return finalUrl;
  }

  console.warn('[Poster] URL generada no válida o fallback; devolviendo fallback sin cachear');
  return generateFallbackPoster({ hora });
}

async function scrapePostersConcurrenciaLimitada(eventos, limite = 4) {
  const resultados = [];
  const cola = [...eventos];
  const activos = [];

  while (cola.length > 0 || activos.length > 0) {
    while (activos.length < limite && cola.length > 0) {
      const evento = cola.shift();
      const promesa = scrapePosterForMatch(evento).then(url => {
        evento.poster = url;
        resultados.push(evento);
      });
      activos.push(promesa);
    }
    await Promise.race(activos);
    activos.splice(0, activos.length, ...activos.filter(p => !p.isFulfilled));
  }

  return resultados;
}

module.exports = {
  scrapePosterForMatch,
  scrapePostersConcurrenciaLimitada,
  generatePlaceholdPoster: generateFallbackPoster
};
