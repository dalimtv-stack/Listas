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

    // Generar imagen con la hora como texto
    const horaImage = await sharp({
      create: {
        width: 300,
        height: 80,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0.6 }
      }
    })
      .png()
      .composite([
        {
          input: Buffer.from(
            `<svg width="300" height="80">
              <text x="150" y="55" font-size="36" fill="white" text-anchor="middle" font-family="Arial" font-weight="bold">
                ${hora}
              </text>
            </svg>`
          ),
          top: 0,
          left: 0
        }
      ])
      .toBuffer();

    const composed = await sharp(buffer)
      .composite([{ input: horaImage, top: 10, left: 10 }])
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
