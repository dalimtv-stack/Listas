// api/poster-con-hora.js
'use strict';

const Jimp = require('jimp');
const sharp = require('sharp');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const { kvGetJson, kvSetJsonTTLIfChanged } = require('./kv'); // Asegúrate de apuntar a tu KV

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

  console.info('[Poster con hora] URL de imagen de entrada:', url);

  // KV key base para posters del día de hoy
  const todayKey = 'postersBlobHoy';
  const kvCache = (await kvGetJson(todayKey)) || {};

  // Coger basename de la imagen original para nombre determinista del blob
  let originalBasename = 'original';
  try {
    const p = new URL(url).pathname;
    originalBasename = path.basename(p) || 'original';
  } catch (e) {
    // ignore
  }

  // Descarga inicial del buffer
  let buffer;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`No se pudo obtener imagen: ${response.status}`);
    buffer = await response.buffer();
    const contentType = response.headers.get('content-type') || '';

    // Solo convertir webp -> png si es necesario
    if (contentType.includes('webp') || Buffer.isBuffer(buffer) && buffer.slice(0, 4).toString() === 'RIFF') {
      try {
        buffer = await sharp(buffer).png().toBuffer();
      } catch (err) {
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
  const fontPath = path.join(__dirname, '..', 'fonts', 'open-sans-64-white.fnt');
  if (!fs.existsSync(fontPath)) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Fuente no encontrada para generar pósters.' }));
  }

  const font = await Jimp.loadFont(fontPath);
  const results = [];
  let baseImage;
  try {
    baseImage = await Jimp.read(buffer);
  } catch (err) {
    console.warn('[Poster con hora] Jimp no pudo leer el buffer inicial. Usando fallback:', err.message);
    for (const hora of horas) results.push({ hora, url });
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(results));
  }

  // Generar posters
  for (const hora of horas) {
    const safeHora = slugify(hora);
    const blobName = `${slugify(originalBasename)}_${safeHora}.png`;

    // 1) Comprobar KV si ya existe poster generado para hoy
    if (kvCache[blobName]) {
      results.push({ hora, url: kvCache[blobName] });
      continue;
    }

    // 2) Generar overlay de hora sobre la imagen base
    const image = baseImage.clone();
    const textWidth = Jimp.measureText(font, hora);
    const textHeight = Jimp.measureTextHeight(font, hora, textWidth);
    const padding = 20;
    const overlay = new Jimp(textWidth + padding * 2, textHeight + padding * 2, 0x00000099);
    overlay.print(font, padding, padding, hora);
    const xOverlay = Math.floor((image.bitmap.width - overlay.bitmap.width) / 2);
    image.composite(overlay, xOverlay, 10);

    const finalBuffer = await image.getBufferAsync(Jimp.MIME_PNG);

    // 3) Subir a Blob (si existe SDK y token)
    let blobUrl = url; // fallback temporal
    try {
      const blobSdk = require('@vercel/blob');
      const putFn = blobSdk.put || (blobSdk.default && blobSdk.default.put);
      if (putFn && process.env.BLOB_READ_WRITE_TOKEN) {
        const putRes = await putFn(blobName, finalBuffer, {
          access: 'public',
          token: process.env.BLOB_READ_WRITE_TOKEN,
          contentType: 'image/png',
          addRandomSuffix: false
        });
        if (putRes?.url) blobUrl = putRes.url;
      }
    } catch (err) {
      console.warn('[Poster con hora] Error subiendo a Blob, usando fallback temporal:', err.message);
    }

    // Solo guardar en KV si es un URL válido, nunca fallbacks
    if (blobUrl !== url) {
      kvCache[blobName] = blobUrl;
      await kvSetJsonTTLIfChanged(todayKey, kvCache, 86400);
    }

    results.push({ hora, url: blobUrl });
  }

  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(results));
};
