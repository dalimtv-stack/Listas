// api/poster-con-hora.js
'use strict';

const sharp = require('sharp');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

module.exports = async (req, res) => {
  const { url } = req.query;
  const horas = req.body?.horas;

  if (!url || !Array.isArray(horas) || horas.length === 0) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Faltan parámetros "url" y/o "horas[]"' }));
  }

  try {
    const fontDir = path.join(__dirname, 'fonts'); // Ajustado para Vercel
    const fontPath = path.join(fontDir, 'OpenSans-VariableFont_wdth,wght.ttf');

    if (!fs.existsSync(fontPath)) {
      throw new Error(`Font file not found at ${fontPath}`);
    }

    console.info('[Poster con hora] URL de imagen de entrada:', url);

    // Fetch con reintentos y timeout
    const fetchWithRetry = async (url, retries = 3, delay = 1000) => {
      for (let i = 0; i < retries; i++) {
        try {
          const response = await fetch(url, { timeout: 10000 }); // 10s timeout
          if (!response.ok) throw new Error(`No se pudo obtener imagen: ${response.status}`);
          return await response.buffer();
        } catch (err) {
          if (i === retries - 1) throw err;
          console.warn(`Reintentando fetch (${i + 1}/${retries}): ${err.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    };

    const buffer = await fetchWithRetry(url);
    if (!buffer || buffer.length === 0) {
      throw new Error('Buffer vacío recibido desde la URL de imagen');
    }

    const results = [];
    for (const hora of horas) {
      let image = sharp(buffer);
      const metadata = await image.metadata();

      // Convertir la fuente TTF a base64 para incrustarla directamente
      const fontBase64 = fs.readFileSync(fontPath).toString('base64');
      const textSvg = `
        <svg width="${metadata.width}" height="${metadata.height}">
          <style>
            @font-face {
              font-family: "OpenSans";
              src: url("data:font/truetype;base64,${fontBase64}") format("truetype");
            }
          </style>
          <rect x="0" y="0" width="${metadata.width}" height="100" fill="rgba(0,0,0,0.6)" />
          <text x="50%" y="50" font-family="OpenSans" font-size="64" fill="white" text-anchor="middle" dy=".3em">
            ${hora}
          </text>
        </svg>
      `;

      image = image.composite([
        {
          input: Buffer.from(textSvg),
          gravity: 'north',
        },
      ]);

      const finalBuffer = await image.webp({ quality: 80 }).toBuffer();
      const base64 = finalBuffer.toString('base64');
      const dataUrl = `data:image/webp;base64,${base64}`;
      results.push({ hora, url: dataUrl });
    }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(results));
  } catch (err) {
    console.error('[Poster con hora] Error:', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `Error generando pósters: ${err.message}` }));
  }
};
