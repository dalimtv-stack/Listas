// src/eventos/poster-events.js
'use strict';

const puppeteer = require('puppeteer');

// Normaliza nombres de partidos para matching
function normalizeMatchName(matchName) {
  return matchName
    .toLowerCase()
    .replace(/\bvs\b/gi, '-') // Cambia "VS" por "-"
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Elimina acentos
    .replace(/\s+/g, ' ')
    .trim();
}

// Genera un póster de fallback con placehold.co
function generatePlaceholdPoster(partido, competicion) {
  const text = `${competicion}\n\n${partido}`;
  return `https://placehold.co/938x1406@3x/999999/80f4eb?text=${encodeURIComponent(text)}&font=poppins&png`;
}

// Scrapea póster para un partido desde Movistar Plus+
async function scrapePosterForMatch(partido, competicion) {
  try {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto('https://www.movistarplus.es/el-partido-movistarplus', { waitUntil: 'networkidle2', timeout: 30000 });

    const normalizedPartido = normalizeMatchName(partido);
    const normalizedCompeticion = normalizeMatchName(competicion);

    const posterUrl = await page.evaluate((matchName, league) => {
      const images = Array.from(document.querySelectorAll('img[alt*="LaLiga"], img[src*="banner"], img[src*="poster"], img[src*="match"]'));
      return images
        .find(img => {
          const alt = img.alt?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
          const src = img.src?.toLowerCase() || '';
          return alt.includes(matchName) || src.includes(matchName) || alt.includes(league) || src.includes(league);
        })?.src || null;
    }, normalizedPartido, normalizedCompeticion);

    await browser.close();

    if (posterUrl && posterUrl.startsWith('http')) {
      console.log(`[POSTER] Encontrado póster para ${partido}: ${posterUrl}`);
      return posterUrl;
    } else {
      console.log(`[POSTER] No se encontró póster para ${partido}, usando fallback`);
      return generatePlaceholdPoster(partido, competicion);
    }
  } catch (err) {
    console.error(`[POSTER] Error al scrapear póster para ${partido}:`, err.message);
    return generatePlaceholdPoster(partido, competicion);
  }
}

module.exports = { scrapePosterForMatch };
