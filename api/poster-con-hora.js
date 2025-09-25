// api/poster-con-hora.js
'use strict';

const Jimp = require('jimp');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

module.exports = async (req, res) => {
  const { url, hora = '20:45' } = req.query;

  if (!url) {
    res.statusCode = 400;
    return res.end('Falta el parámetro "url"');
  }

  try {
    const fontDir = path.join(__dirname, '..', 'fonts');
    const fontPath = path.join(fontDir, 'open-sans-32-white.fnt');
    const pngPath = path.join(fontDir, 'open-sans-32-white.png');

    if (!fs.existsSync(fontPath) || !fs.existsSync(pngPath)) {
      throw new Error('Font files not found en /fonts');
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`No se pudo obtener la imagen: ${response.status}`);
    const buffer = await response.buffer();

    const image = await Jimp.read(buffer);
    const font = await Jimp.loadFont(fontPath);

    const overlayWidth = 300;
    const overlayHeight = 80;
    const overlay = new Jimp(overlayWidth, overlayHeight, 0x00000099);

    const textWidth = Jimp.measureText(font, hora);
    const x = Math.floor((overlayWidth - textWidth) / 2);
    const y = 10; // más arriba para mejor estética

    overlay.print(font, x, y, hora);
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
