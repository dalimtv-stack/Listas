// api/poster-con-hora.js
'use strict';

const Jimp = require('jimp');
const sharp = require('sharp');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const { put } = require('@vercel/blob');

module.exports = async (req, res) => {
  const { url } = req.query;
  const horas = req.body?.horas;

  if (!url || !Array.isArray(horas) || horas.length === 0) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Faltan parámetros "url" y/o "horas[]"' }));
  }

  console.info('[Poster con hora] URL de imagen de entrada:', url);

  let buffer;
  try {
    const response = await fetch(url);
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) throw new Error(`No se pudo obtener imagen: ${response.status}`);

    buffer = await response.buffer();
    if (!buffer || buffer.length === 0) throw new Error('Buffer vacío recibido desde la URL');

    if (contentType.includes('webp')) {
      try {
        buffer = await sharp(buffer).png().toBuffer();
        console.info('[Poster con hora] Conversión .webp -> PNG completada.');
      } catch (err) {
        console.warn('[Poster con hora] Fallo al convertir .webp, se usará buffer original:', err.message);
      }
    }
  } catch (err) {
    console.error('[Poster con hora] No se pudo obtener la imagen original:', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'No se pudo obtener la imagen original.' }));
  }

  // Cargar fuente para Jimp
  const fontDir = path.join(__dirname, '..', 'fonts');
  const fontPath = path.join(fontDir, 'open-sans-64-white.fnt');
  if (!fs.existsSync(fontPath)) {
    console.error('[Poster con hora] Font file no encontrado en /fonts');
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Fuente no encontrada para generar pósters.' }));
  }

  const results = [];
  const baseImage = await Jimp.read(buffer);
  const font = await Jimp.loadFont(fontPath);

  for (const hora of horas) {
    let blobUrl = url; // fallback inicial: URL original
    try {
      // Generar imagen con hora
      const image = baseImage.clone();
      const textWidth = Jimp.measureText(font, hora);
      const textHeight = Jimp.measureTextHeight(font, hora, textWidth);
      const padding = 20;
      const overlay = new Jimp(textWidth + padding * 2, textHeight + padding * 2, 0x00000099);
      overlay.print(font, padding, padding, hora);
      const xOverlay = Math.floor((image.bitmap.width - overlay.bitmap.width) / 2);
      image.composite(overlay, xOverlay, 10);

      const finalBuffer = await image.getBufferAsync('image/png');

      // Subir al Blob con `put`
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        try {
          const { url: uploadedUrl } = await put(`posters/poster_${hora}.png`, finalBuffer, {
            access: 'public',
            token: process.env.BLOB_READ_WRITE_TOKEN,
            contentType: 'image/png',
            addRandomSuffix: true,
          });
          if (uploadedUrl) blobUrl = uploadedUrl;
          else console.warn(`[Poster con hora] No se recibió URL del blob para "${hora}", se usará fallback.`);
        } catch (err) {
          console.warn(`[Poster con hora] Error subiendo a Blob para "${hora}", se usará fallback:`, err.message);
        }
      } else {
        console.warn('[Poster con hora] BLOB_READ_WRITE_TOKEN no configurado, usando fallback.');
      }
    } catch (err) {
      console.warn(`[Poster con hora] Error generando póster con hora "${hora}", se usará fallback:`, err.message);
      blobUrl = url;
    }

    results.push({ hora, url: blobUrl });
  }

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(results));
};
