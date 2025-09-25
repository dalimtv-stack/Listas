// api/poster-con-hora.js
'use strict';

const Jimp = require('jimp');
const fetch = require('node-fetch');
const path = require('path');

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

    const image = await Jimp.read(buffer);

    // Ruta absoluta a la fuente bitmap
    const fontPath = path.join(__dirname, '..', 'fonts', 'open-sans-32-white.fnt');
    const font = await Jimp.loadFont(fontPath);

    // Fondo semitransparente
    const overlay = new Jimp(300, 80, 0x00000099); // negro con alpha

    overlay.print(
      font,
      0,
      20,
      {
        text: hora,
        alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
        alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
      },
      300,
      80
    );

    image.composite(overlay, 10, 10);

    const finalBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
    res.setHeader('Content-Type', 'image/jpeg');
    res.end(finalBuffer);
  } catch (err) {
    console.error('[Poster con hora] Error:', err.message);
    res.statusCode = 500;
    res.end('Error generando póster');
  }
};
