// src/eventos/poster-events.js
'use strict';

const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');

// Normaliza nombres de partidos para matching
function normalizeMatchName(matchName) {
  return matchName
    .toLowerCase()
    .replace(/\bvs\b/gi, '-') // Cambia "VS" por "-"
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Elimina acentos
    .replace(/\s+/g, ' ')
    .trim();
}

// Genera un póster de fallback con hora, deporte y competición
function generatePlaceholdPoster({ hora, deporte, competicion }) {
  const text = `${hora}\n \n${deporte}\n \n${competicion}`;
  return `https://placehold.co/938x1406@3x/999999/80f4eb?text=${encodeURIComponent(text)}&font=poppins&png`;
}

// Scrapea póster para un partido desde Movistar Plus+
async function scrapePosterForMatch({ partido, hora, deporte, competicion }) {
  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.goto('https://www.movistarplus.es/el-partido-movistarplus', { waitUntil: 'networkidle2', timeout: 30000 });

    const normalizedPartido = normalizeMatchName(partido);

    const posterUrl = await page.evaluate(matchName => {
      const images = Array.from(document.querySelectorAll('img'));
      return images.find(img => {
        const alt = img.alt?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
        const src = img.src?.toLowerCase() || '';
        return alt.includes(matchName) || src.includes(matchName);
      })?.src || null;
    }, normalizedPartido);

    await browser.close();

    if (posterUrl && posterUrl.startsWith('http')) {
      console.log(JSON.stringify({
        level: 'info',
        scope: 'poster-events',
        match: partido,
        poster: posterUrl,
        status: 'found'
      }));
      return posterUrl;
    } else {
      const fallback = generatePlaceholdPoster({ hora, deporte, competicion });
      console.log(JSON.stringify({
        level: 'warn',
        scope: 'poster-events',
        match: partido,
        poster: fallback,
        status: 'fallback'
      }));
      return fallback;
    }
  } catch (err) {
    const fallback = generatePlaceholdPoster({ hora, deporte, competicion });
    console.error(JSON.stringify({
      level: 'error',
      scope: 'poster-events',
      match: partido,
      error: err.stack || err.message,
      poster: fallback,
      status: 'error-fallback'
    }));
    return fallback;
  }
}

module.exports = { scrapePosterForMatch };
