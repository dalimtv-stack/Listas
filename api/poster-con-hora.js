// api/poster-con-hora.js
'use strict';

const Jimp = require('jimp');
const sharp = require('sharp');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const { kvGetJsonTTL, kvSetJsonTTLIfChanged } = require('./kv');
const { uploadImageCloudinary } = require('../lib/upload-to-cloudinary');

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[:\s\/\\]+/g, '_')
    .replace(/[^a-z0-9_\-\.]/g, '');
}

module.exports = async (req, res) => {
  const { url } = req.query;
  const horas = req.body?.horas;

  if (!url || !Array.isArray(horas) || horas.length === 0) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Faltan parámetros "url" y/o "horas[]"' }));
  }

  // Coger basename de la imagen original para nombre determinista
  let originalBasename = 'original';
  try {
    const p = new URL(url).pathname;
    originalBasename = path.basename(p) || 'original';
  } catch (e) {
    // ignore
  }

  // Descarga / conversión inicial
  let buffer;
  try {
    const response = await fetch(url);
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) throw new Error(`No se pudo obtener imagen: ${response.status}`);
    buffer = await response.buffer();
    if (!buffer || buffer.length === 0) throw new Error('Buffer vacío recibido desde la URL');

    // Solo convertir webp -> png si es necesario
    if (contentType.includes('webp') || Buffer.isBuffer(buffer) && buffer.slice(0, 4).toString() === 'RIFF') {
      try {
        buffer = await sharp(buffer).png().toBuffer();
      } catch (err) {
        // si falla la conversión, seguimos con el buffer original y Jimp intentará leerlo
        console.warn('[Poster con hora] Falló la conversión con sharp, se intentará con Jimp directamente:', err.message);
      }
    }
  } catch (err) {
    console.error('[Poster con hora] No se pudo obtener la imagen original:', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'No se pudo obtener la imagen original.' }));
  }

  // Cargar fuente
  const fontDir = path.join(__dirname, '..', 'fonts');
  const fontPath = path.join(fontDir, 'open-sans-64-white.fnt');
  if (!fs.existsSync(fontPath)) {
    console.error('[Poster con hora] Font file no encontrado en /fonts');
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Fuente no encontrada para generar pósters.' }));
  }

  const results = [];
  let baseImage;
  try {
    baseImage = await Jimp.read(buffer);
    const TARGET_WIDTH = 405;
    const TARGET_HEIGHT = 600;
    
    baseImage.contain(
      TARGET_WIDTH,
      TARGET_HEIGHT,
      Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE
    );

  } catch (err) {
    console.warn('[Poster con hora] Jimp no pudo leer el buffer inicial. Intentaremos usar fallback para todas las horas.', err.message);
    // Si Jimp no puede leer el buffer, devolvemos fallback para todas las horas
    for (const hora of horas) results.push({ hora, url });
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(results));
  }

  const font = await Jimp.loadFont(fontPath);

  for (const hora of horas) {
    let blobUrl = url; // fallback por defecto: la URL original
    const safeHora = slugify(hora);
    const todayKey = new Date().toISOString().slice(0,10).replace(/-/g, ''); // YYYYMMDD
    const blobName = `posters/${slugify(originalBasename)}_${todayKey}_${safeHora}.png`;

    try {
      // Generar la imagen con la hora (con Jimp sobre el baseImage)
      const image = baseImage.clone();
      const textWidth = Jimp.measureText(font, hora);
      const textHeight = Jimp.measureTextHeight(font, hora, textWidth);
      const padding = 20;
      const overlay = new Jimp(textWidth + padding * 2, textHeight + padding * 2, 0x00000099);
      overlay.print(font, padding, padding, hora);
      const xOverlay = Math.floor((image.bitmap.width - overlay.bitmap.width) / 2);
      image.composite(overlay, xOverlay, 10);

      const finalBuffer = await image.getBufferAsync(Jimp.MIME_PNG);

      // Subir a Cloudinary
      try {
        console.info(`[Poster con hora] Subiendo imagen a Cloudinary: ${blobName}`);
        const result = await uploadImageCloudinary(finalBuffer, blobName.replace('.png', ''), 'Posters');
        if (result && result.url) {
          blobUrl = result.url;
          // Actualizar índice KV
          try {
            const indexKey = 'posters:index';
            const currentList = await kvGetJsonTTL(indexKey) || [];
            const updatedList = [...new Set([...currentList, result.public_id])];
            await kvSetJsonTTLIfChanged(indexKey, updatedList, 30 * 24 * 3600); // TTL de 30 días
          } catch (errKV) {
            console.warn(`[Poster con hora] Error actualizando índice KV para "${result.public_id}":`, errKV.message);
          }
          console.info('[Poster con hora] Imagen subida a Cloudinary:', blobUrl);
        } else {
          console.warn('[Poster con hora] uploadImageCloudinary no devolvió url, se usará fallback.');
        }
      } catch (errUpload) {
        console.warn(`[Poster con hora] Error subiendo a Cloudinary para "${hora}":`, errUpload?.message || errUpload);
        // Si falla la subida, dejamos blobUrl = url (fallback)
      }
    } catch (errGenerate) {
      // Si al generar la imagen falla algo (Jimp o similar), devolvemos fallback (la url original)
      console.warn(`[Poster con hora] Error generando póster para "${hora}", usando fallback:`, errGenerate.message || errGenerate);
      blobUrl = url;
    }

    results.push({ hora, url: blobUrl });
  }

  // Respuesta final siempre JSON
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(results));
};
