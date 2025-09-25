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
    const fontPath = path.join(fontDir, 'open-sans-64-white.fnt');
    const pngPath = path.join(fontDir, 'open-sans-64-white.png');

    if (!fs.existsSync(fontPath) || !fs.existsSync(pngPath)) {
      throw new Error('Font files not found en /fonts');
    }

    console.log('[Poster con hora] Fetching:', url);
    const response = await fetch(url);
    const contentType = response.headers.get('content-type');
    const status = response.status;

    if (!response.ok) throw new Error(`No se pudo obtener la imagen: ${status} ${response.statusText}`);
    if (!contentType || !contentType.startsWith('image/')) {
      throw new Error(`Tipo de contenido inválido: ${contentType}`);
    }

    const buffer = await response.buffer();
    if (!buffer || buffer.length === 0) {
      throw new Error('Buffer vacío recibido desde la URL de imagen');
    }

    console.log('[Poster con hora] Content-Type:', contentType);
    console.log('[Poster con hora] Buffer size:', buffer.length);

    const baseImage = await Jimp.read(buffer);
    const font = await Jimp.loadFont(fontPath);

    // Clonar imagen para no mutar el original
    const image = baseImage.clone();

    const textWidth = Jimp.measureText(font, hora);
    const textHeight = Jimp.measureTextHeight(font, hora, textWidth);

    const padding = 20;
    const overlayWidth = textWidth + padding * 2;
    const overlayHeight = textHeight + padding * 2;

    const overlay = new Jimp(overlayWidth, overlayHeight, 0x00000099);

    overlay.print(font, padding, padding, hora);

    const xOverlay = Math.floor((image.bitmap.width - overlayWidth) / 2);
    const yOverlay = 10;

    image.composite(overlay, xOverlay, yOverlay);

    const finalBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
    res.setHeader('Content-Type', 'image/jpeg');
    res.end(finalBuffer);
  } catch (err) {
    console.error('[Poster con hora] Error:', err.message);
    res.statusCode = 500;
    res.end(`Error generando póster: ${err.message}`);
  }
};
