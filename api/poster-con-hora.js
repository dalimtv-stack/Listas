// api/poster-con-hora.js
'use strict';

const { createCanvas, loadImage } = require('canvas');
const fetch = require('node-fetch');
const pLimit = require('p-limit');

module.exports = async (req, res) => {
  const { url } = req.query;
  const horas = req.body?.horas;

  if (!url || !Array.isArray(horas) || horas.length === 0) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Faltan parámetros "url" y/o "horas[]"' }));
  }

  try {
    console.info('[Poster con hora] URL de imagen de entrada:', url);

    // Fetch con reintentos y timeout
    const fetchWithRetry = async (url, retries = 3, delay = 1000) => {
      for (let i = 0; i < retries; i++) {
        try {
          const response = await fetch(url, { timeout: 15000 });
          if (!response.ok) throw new Error(`No se pudo obtener imagen: ${response.status}`);
          const buffer = await response.buffer();
          console.info('[Poster con hora] Buffer length:', buffer.length);
          return buffer;
        } catch (err) {
          console.warn(`[Poster con hora] Reintentando fetch (${i + 1}/${retries}): ${err.message}`);
          if (i === retries - 1) throw err;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    };

    // Descargar y optimizar la imagen
    const buffer = await fetchWithRetry(url);
    if (!buffer || buffer.length === 0) {
      throw new Error('Buffer vacío recibido desde la URL de imagen');
    }

    // Limitar concurrencia para evitar sobrecarga en Vercel
    const limit = pLimit(1); // Reducido a 1 para minimizar sobrecarga
    const results = await Promise.all(
      horas.map(hora =>
        limit(async () => {
          // Cargar la imagen
          const image = await loadImage(buffer);
          const canvas = createCanvas(image.width > 1920 ? 1920 : image.width, image.height > 1080 ? 1080 : image.height);
          const ctx = canvas.getContext('2d');

          // Redimensionar la imagen si es necesario
          if (image.width > 1920 || image.height > 1080) {
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          } else {
            ctx.drawImage(image, 0, 0);
          }

          // Dibujar el rectángulo semi-transparente
          ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
          ctx.fillRect(0, 0, canvas.width, 100);

          // Dibujar el texto
          ctx.font = '64px Arial';
          ctx.fillStyle = 'white';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(hora, canvas.width / 2, 50);

          const finalBuffer = canvas.toBuffer('image/webp', { quality: 0.8 });
          console.info('[Poster con hora] Final buffer length:', finalBuffer.length);
          const base64 = finalBuffer.toString('base64');
          const dataUrl = `data:image/webp;base64,${base64}`;
          return { hora, url: dataUrl };
        })
      )
    );

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(results));
  } catch (err) {
    console.error('[Poster con hora] Error:', err.message, err.stack);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `Error generando pósters: ${err.message}` }));
  }
};
