// api/poster-con-hora.js
'use strict';

const Jimp = require('jimp');
const sharp = require('sharp');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

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

  //console.info('[Poster con hora] URL de imagen de entrada:', url);

  // Intento de cargar SDK de Vercel Blob (si no está instalado no rompemos)
  let putFn = null;
  let headFn = null;
  try {
    const blobSdk = require('@vercel/blob');
    // compatibilidad con posibles exportaciones default
    putFn = blobSdk.put || (blobSdk.default && blobSdk.default.put);
    headFn = blobSdk.head || (blobSdk.default && blobSdk.default.head);
    if (typeof putFn !== 'function') putFn = null;
    if (typeof headFn !== 'function') headFn = null;
  } catch (e) {
    console.warn('[Poster con hora] @vercel/blob no está disponible. Se usará fallback (no subirá archivos).', e.message);
  }

  // Coger basename de la imagen original para nombre determinista del blob
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

    // Solo convertir webp -> png si es necesario (como hacías)
    if (contentType.includes('webp') || Buffer.isBuffer(buffer) && buffer.slice(0, 4).toString() === 'RIFF') {
      try {
        buffer = await sharp(buffer).png().toBuffer();
        //console.info('[Poster con hora] Conversión .webp -> PNG completada.');
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
    const TARGET_WIDTH = 600;
    const TARGET_HEIGHT = 405;
    
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
      // 1) Si tenemos headFn, comprobar si ya existe (si devuelve info con url la usamos)
      if (headFn && putFn && process.env.BLOB_READ_WRITE_TOKEN) {
        try {
          const headRes = await headFn(blobName, { token: process.env.BLOB_READ_WRITE_TOKEN });
          if (headRes && headRes.url) {
            //console.info(`[Poster con hora] Ya existía en blob, se sobrescribirá: ${blobName}`);
          }
          // si headRes no tiene url puede que head no devuelva la url; seguimos a intentar put
        } catch (errHead) {
          // head puede fallar con 404 o con Access denied; si falla, vamos a intentar subir
          // pero si es un error claro de permisos, lo registramos y seguiremos al fallback
          if (errHead && /access|forbidden|token/i.test(String(errHead.message))) {
            console.warn(`[Poster con hora] head() fallo por permisos para "${blobName}":`, errHead.message);
            // no abortamos, seguiremos intentando subir (put puede fallar también)
          } else {
            // comúnmente será 404 (no existe): lo ignoramos y proseguimos a subir
            // console.info('[Poster con hora] head() no encontró blob, se intentará subir.');
          }
        }
      }

      // 2) Generar la imagen con la hora (con Jimp sobre el baseImage)
      const image = baseImage.clone();
      const textWidth = Jimp.measureText(font, hora);
      const textHeight = Jimp.measureTextHeight(font, hora, textWidth);
      const padding = 20;
      const overlay = new Jimp(textWidth + padding * 2, textHeight + padding * 2, 0x00000099);
      overlay.print(font, padding, padding, hora);
      const xOverlay = Math.floor((image.bitmap.width - overlay.bitmap.width) / 2);
      image.composite(overlay, xOverlay, 10);

      const finalBuffer = await image.getBufferAsync(Jimp.MIME_PNG);

      // 3) Intentar subir via @vercel/blob.put si está disponible
      if (putFn && process.env.BLOB_READ_WRITE_TOKEN) {
        try {
          //console.info(`[Poster con hora] Subiendo imagen a Blob: ${blobName}`);
          // put acepta Buffer directamente
          const putRes = await putFn(blobName, finalBuffer, {
            access: 'public',
            token: process.env.BLOB_READ_WRITE_TOKEN,
            contentType: 'image/png',
            addRandomSuffix: false
          });
          if (putRes && putRes.url) {
            blobUrl = putRes.url;
            //console.info('[Poster con hora] Imagen subida a Blob:', blobUrl);
          } else {
            console.warn('[Poster con hora] put() no devolvió url, se usará fallback.');
          }
        } catch (errPut) {
          console.warn(`[Poster con hora] Error subiendo a Blob para "${hora}":`, errPut?.message || errPut);
          // Si falla la subida, dejamos blobUrl = url (fallback)
        }
      } else {
        // SDK no disponible o token faltante -> no intentamos subir
        if (!putFn) console.warn('[Poster con hora] SDK @vercel/blob no disponible; no se intentará subir.');
        if (!process.env.BLOB_READ_WRITE_TOKEN) console.warn('[Poster con hora] BLOB_READ_WRITE_TOKEN no configurado; usando fallback.');
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
