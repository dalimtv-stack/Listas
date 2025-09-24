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

    // Crear imagen con fondo y texto renderizado como imagen
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
          input: {
            text: {
              text: hora,
              font: 'sans',
              fontSize: 36,
              rgba: true
            }
          },
          top: 20,
          left: 60
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
