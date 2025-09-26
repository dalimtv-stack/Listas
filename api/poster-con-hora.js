// api/poster-con-hora.js
'use strict';

const Jimp = require('jimp');
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
    const fontDir = path.join(__dirname, '..', 'fonts');
    const fontPath = path.join(fontDir, 'open-sans-64-white.fnt');
    const pngPath = path.join(fontDir, 'open-sans-64-white.png');

    if (!fs.existsSync(fontPath) || !fs.existsSync(pngPath)) {
      throw new Error('Font files not found en /fonts');
    }

    console.info('[Poster con hora] URL de imagen de entrada:', url);

    const response = await fetch(url);
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      throw new Error(`No se pudo obtener imagen: ${response.status}`);
    }

    const buffer = await response.buffer();
    if (!buffer || buffer.length === 0) {
      throw new Error('Buffer vacío recibido desde la URL de imagen');
    }

    let decodedBuffer = buffer;
    if (contentType.includes('webp')) {
      console.info('[Poster con hora] Detected .webp, intentando convertir con sharp...');
      try {
        decodedBuffer = await sharp(buffer).png().toBuffer();
        console.info('[Poster con hora] Conversión con sharp completada. Esperando confirmación...');
        await new Promise(resolve => setTimeout(resolve, 50)); // pausa defensiva
      } catch (err) {
        throw new Error(`Sharp no pudo convertir .webp: ${err.message}`);
      }
    }

    console.info('[Poster con hora] Buffer listo para Jimp. Tamaño:', decodedBuffer.length);

    let baseImage;
    try {
      baseImage = await Jimp.read(decodedBuffer);
    } catch (err) {
      throw new Error(`Jimp no pudo procesar la imagen: ${err.message}`);
    }

    const font = await Jimp.loadFont(fontPath);
    const results = [];

    for (const hora of horas) {
      const image = baseImage.clone();
      const textWidth = Jimp.measureText(font, hora);
      const textHeight = Jimp.measureTextHeight(font, hora, textWidth);
      const padding = 20;
      const overlay = new Jimp(textWidth + padding * 2, textHeight + padding * 2, 0x00000099);
      overlay.print(font, padding, padding, hora);
      const xOverlay = Math.floor((image.bitmap.width - overlay.bitmap.width) / 2);
      image.composite(overlay, xOverlay, 10);

      const finalBuffer = await image.getBufferAsync('image/png');
      const base64 = finalBuffer.toString('base64');
      const dataUrl = `data:image/png;base64,${base64}`;
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
