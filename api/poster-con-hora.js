// api/poster-con-hora.js
'use strict';

const sharp = require('sharp');
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

    // Optimizar la imagen de entrada
    const buffer = await fetchWithRetry(url);
    if (!buffer || buffer.length === 0) {
      throw new Error('Buffer vacío recibido desde la URL de imagen');
    }

    // Redimensionar la imagen para reducir el tiempo de procesamiento
    const optimizedBuffer = await sharp(buffer)
      .resize({ width: 1920, withoutEnlargement: true })
      .toBuffer();
    console.info('[Poster con hora] Optimized buffer length:', optimizedBuffer.length);

    // Limitar concurrencia para evitar sobrecarga en Vercel
    const limit = pLimit(2);
    const results = await Promise.all(
      horas.map(hora =>
        limit(async () => {
          let image = sharp(optimizedBuffer);
          const metadata = await image.metadata();
          console.info('[Poster con hora] Image metadata:', metadata);

          // Crear una imagen de texto separada en lugar de usar SVG
          const textImage = await sharp({
            create: {
              width: metadata.width,
              height: 100,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 0.6 },
            },
          })
            .composite([
              {
                input: Buffer.from(
                  `<svg width="${metadata.width}" height="100">
                     <text x="50%" y="50" font-family="Arial" font-size="64" fill="white" text-anchor="middle" dy=".3em">
                       ${hora}
                     </text>
                   </svg>`
                ),
                gravity: 'center',
              },
            ])
            .png()
            .toBuffer();

          // Combinar la imagen de texto con la imagen principal
          image = image.composite([
            {
              input: textImage,
              gravity: 'north',
              top: 0,
              left: 0,
            },
          ]);

          const finalBuffer = await image.webp({ quality: 80 }).toBuffer();
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
