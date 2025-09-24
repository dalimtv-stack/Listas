// api/poster-con-hora.js
'use strict';

const sharp = require('sharp');
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const { url, hora = '20:45' } = req.query;

  if (!url) {
    res.statusCode = 400;
    return res.end('Falta el parámetro "url"');
  }

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`No se pudo obtener la imagen: ${response.status}`);
    const buffer = await response.buffer();

    // SVG con texto plano (sin emoji) para evitar Fontconfig error
    const overlaySvg = `
      <svg width="300" height="80">
        <rect x="0" y="0" width="300" height="80" rx="8" ry="8" fill="rgba(0,0,0,0.6)" />
        <text x="150" y="50" font-size="36" fill="white" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold">
          ${hora}
        </text>
      </svg>
    `;

    const overlayBuffer = Buffer.from(overlaySvg);
    const overlayImage = await sharp(overlayBuffer).png().toBuffer();

    const composed = await sharp(buffer)
      .composite([{ input: overlayImage, top: 10, left: 10 }])
      .jpeg()
      .toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    res.end(composed);
  } catch (err) {
    console.error('[Poster con hora] Error:', err.message);
    res.statusCode = 500;
    res.end('Error generando póster');
  }
};
