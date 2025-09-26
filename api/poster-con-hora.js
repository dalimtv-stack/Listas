// api/poster-con-hora.js
'use strict';

const sharp = require('sharp');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const pLimit = require('p-limit');

// Deshabilitar fontconfig explícitamente
process.env.LIBVIPS_NO_FONTCONFIG = 'true';

module.exports = async (req, res) => {
  const { url } = req.query;
  const horas = req.body?.horas;

  if (!url || !Array.isArray(horas) || horas.length === 0) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Faltan parámetros "url" y/o "horas[]"' }));
  }

  try {
    const fontDir = path.join(__dirname, '..', 'fonts');
    const fontPath = path.join(fontDir, 'OpenSans-VariableFont_wdth,wght.ttf');

    console.info('[Poster con hora] Font path:', fontPath);
    if (!fs.existsSync(fontPath)) {
      throw new Error(`Font file not found at ${fontPath}`);
    }

    console.info('[Poster con hora] URL de imagen de entrada:', url);

    // Fetch con reintentos y timeout
    const fetchWithRetry = async (url, retries = 3, delay = 1000) => {
      for (let i = 0; i < retries; i++) {
        try {
          const response = await fetch(url, { timeout: 15000 });
          if (!response.ok) throw new Error(`No se pudo obtener imagen: ${response.status}`);
          const buffer = await response.buffer();
          console.info('[Poster con hora] Buffer length:', buffer.length);
          return buffer;
        } catch (err) {
          console.warn(`[Poster con hora] Reintentando fetch (${i + 1}/${retries}): ${err.message}`);
          if (i === retries - 1) throw err;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    };

    // Optimizar la imagen de entrada
    const buffer = await fetchWithRetry(url);
    if (!buffer || buffer.length === 0) {
      throw new Error('Buffer vacío recibido desde la URL de imagen');
    }

    // Redimensionar la imagen para reducir el tiempo de procesamiento
    const optimizedBuffer = await sharp(buffer)
      .resize({ width: 1920, withoutEnlargement: true })
      .toBuffer();
    console.info('[Poster con hora] Optimized buffer length:', optimizedBuffer.length);

    const fontBase64 = fs.readFileSync(fontPath).toString('base64');
    console.info('[Poster con hora] Font base64 length:', fontBase64.length);

    // Limitar concurrencia para evitar sobrecarga en Vercel
    const limit = pLimit(2);
    const results = await Promise.all(
      horas.map(hora =>
        limit(async () => {
          let image = sharp(optimizedBuffer);
          const metadata = await image.metadata();
          console.info('[Poster con hora] Image metadata:', metadata);

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
          console.info('[Poster con hora] Final buffer length:', finalBuffer.length);
          const base64 = finalBuffer.toString('base64');
          const dataUrl = `data:image/webp;base64,${base64}`;
          return { hora, url: dataUrl };
        })
      )
    );

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(results));
  } catch (err) {
    console.error('[Poster con hora] Error:', err.message, err.stack);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `Error generando pósters: ${err.message}` }));
  }
};
