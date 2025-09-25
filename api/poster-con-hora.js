// api/poster-con-hora.js
'use strict';

const Jimp = require('jimp');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const { kvGetJson, kvSetJson } = require('./kv');

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    let posters;
    try {
      posters = req.body.posters;
      if (!Array.isArray(posters) || posters.length === 0) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: 'Se espera un array de posters' }));
      }
    } catch (err) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Body JSON inválido' }));
    }

    const results = [];

    try {
      const fontDir = path.join(__dirname, '..', 'fonts');
      const fontPath = path.join(fontDir, 'open-sans-64-white.fnt');
      const pngPath = path.join(fontDir, 'open-sans-64-white.png');

      if (!fs.existsSync(fontPath) || !fs.existsSync(pngPath)) {
        throw new Error('Font files not found en /fonts');
      }

      const font = await Jimp.loadFont(fontPath);

      for (const poster of posters) {
        const { url, horas } = poster;
        if (!url || !Array.isArray(horas) || horas.length === 0) {
          results.push({ originalUrl: url, urls: [], error: 'Falta url o horas' });
          continue;
        }

        try {
          const cacheKey = `base_poster:${url}`;
          let buffer;
          let contentType;
          const cached = await kvGetJson(cacheKey);

          if (cached?.base64 && (Date.now() - cached.createdAt) < 86400 * 1000) {
            buffer = Buffer.from(cached.base64, 'base64');
            contentType = cached.contentType || 'image/png';
            console.log(JSON.stringify({
              level: 'info',
              scope: 'poster-con-hora',
              url,
              status: 'cached'
            }));
          } else {
            console.log(JSON.stringify({
              level: 'info',
              scope: 'poster-con-hora',
              url,
              status: 'fetching'
            }));
            const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
            if (!response.ok) throw new Error(`No se pudo obtener la imagen: ${response.status}`);

            contentType = response.headers.get('content-type');
            if (!contentType?.startsWith('image/')) {
              throw new Error(`Tipo de contenido inválido: ${contentType}`);
            }

            buffer = await response.buffer();
            if (!buffer || buffer.length === 0) {
              throw new Error('Buffer vacío recibido');
            }

            await kvSetJson(cacheKey, {
              base64: buffer.toString('base64'),
              contentType,
              createdAt: Date.now()
            }, { ttl: 86400 * 2 }); // Aumentar TTL a 48 horas
            console.log(JSON.stringify({
              level: 'info',
              scope: 'poster-con-hora',
              url,
              status: 'cached-saved'
            }));
          }

          const baseImage = await Jimp.read(buffer);
          const transformedUrls = [];

          for (const hora of horas) {
            const image = baseImage.clone();
            const textWidth = Jimp.measureText(font, hora);
            const textHeight = Jimp.measureTextHeight(font, hora, textWidth);
            const padding = 20;
            const overlay = new Jimp(textWidth + padding * 2, textHeight + padding * 2, 0x00000099);
            overlay.print(font, padding, padding, hora);
            const xOverlay = Math.floor((image.bitmap.width - overlay.bitmap.width) / 2);
            image.composite(overlay, xOverlay, 10);

            const finalBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
            const base64 = finalBuffer.toString('base64');
            transformedUrls.push({ hora, url: `data:image/jpeg;base64,${base64}` });
          }

          results.push({ originalUrl: url, urls: transformedUrls });
        } catch (err) {
          console.error(JSON.stringify({
            level: 'error',
            scope: 'poster-con-hora',
            url,
            error: err.message,
            status: 'error'
          }));
          results.push({ originalUrl: url, urls: [], error: err.message });
        }
      }

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(results));
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        scope: 'poster-con-hora',
        error: err.message,
        status: 'general-error'
      }));
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `Error generando pósters: ${err.message}` }));
    }
  } else {
    const { url, hora = '20:45' } = req.query;

    if (!url) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'Falta el parámetro "url"' }));
    }

    try {
      const fontDir = path.join(__dirname, '..', 'fonts');
      const fontPath = path.join(fontDir, 'open-sans-64-white.fnt');
      const pngPath = path.join(fontDir, 'open-sans-64-white.png');

      if (!fs.existsSync(fontPath) || !fs.existsSync(pngPath)) {
        throw new Error('Font files not found en /fonts');
      }

      const cacheKey = `base_poster:${url}`;
      let buffer;
      let contentType;
      const cached = await kvGetJson(cacheKey);

      if (cached?.base64 && (Date.now() - cached.createdAt) < 86400 * 1000) {
        buffer = Buffer.from(cached.base64, 'base64');
        contentType = cached.contentType || 'image/png';
        console.log(JSON.stringify({
          level: 'info',
          scope: 'poster-con-hora',
          url,
          status: 'cached'
        }));
      } else {
        console.log(JSON.stringify({
          level: 'info',
          scope: 'poster-con-hora',
          url,
          status: 'fetching'
        }));
        const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error(`No se pudo obtener la imagen: ${response.status}`);

        contentType = response.headers.get('content-type');
        if (!contentType?.startsWith('image/')) {
          throw new Error(`Tipo de contenido inválido: ${contentType}`);
        }

        buffer = await response.buffer();
        if (!buffer || buffer.length === 0) {
          throw new Error('Buffer vacío recibido');
        }

        await kvSetJson(cacheKey, {
          base64: buffer.toString('base64'),
          contentType,
          createdAt: Date.now()
        }, { ttl: 86400 * 2 });
        console.log(JSON.stringify({
          level: 'info',
          scope: 'poster-con-hora',
          url,
          status: 'cached-saved'
        }));
      }

      const image = await Jimp.read(buffer);
      const font = await Jimp.loadFont(fontPath);
      const textWidth = Jimp.measureText(font, hora);
      const textHeight = Jimp.measureTextHeight(font, hora, textWidth);
      const padding = 20;
      const overlay = new Jimp(textWidth + padding * 2, textHeight + padding * 2, 0x00000099);
      overlay.print(font, padding, padding, hora);
      const xOverlay = Math.floor((image.bitmap.width - overlay.bitmap.width) / 2);
      image.composite(overlay, xOverlay, 10);

      const finalBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
      res.setHeader('Content-Type', 'image/jpeg');
      res.end(finalBuffer);
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        scope: 'poster-con-hora',
        url,
        error: err.message,
        status: 'error'
      }));
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `Error generando póster: ${err.message}` }));
    }
  }
};
