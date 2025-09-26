// api/poster-con-hora.js'use strict';
'use strict';

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
    const fontPath = path.join(fontDir, 'OpenSans-VariableFont_wdth,wght.ttf'); // Asegúrate de que sea un archivo TTF

    if (!fs.existsSync(fontPath)) {
      throw new Error('Font file not found en /fonts');
    }

    console.info('[Poster con hora] URL de imagen de entrada:', url);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`No se pudo obtener imagen: ${response.status}`);
    }

    const buffer = await response.buffer();
    if (!buffer || buffer.length === 0) {
      throw new Error('Buffer vacío recibido desde la URL de imagen');
    }

    const results = [];
    for (const hora of horas) {
      // Cargar la imagen con Sharp
      let image = sharp(buffer);

      // Obtener dimensiones de la imagen
      const metadata = await image.metadata();
      const textSvg = `
        <svg width="${metadata.width}" height="${metadata.height}">
          <text x="50%" y="30" font-family="Open Sans" font-size="64" fill="white" text-anchor="middle" dy=".3em" style="opacity: 0.6; background-color: rgba(0,0,0,0.6); padding: 20px;">
            ${hora}
          </text>
        </svg>
      `;

      // Componer la imagen con el texto como overlay
      image = image.composite([
        {
          input: Buffer.from(textSvg),
          gravity: 'north',
        },
      ]);

      // Convertir a WebP
      const finalBuffer = await image.webp({ quality: 80 }).toBuffer();
      const base64 = finalBuffer.toString('base64');
      const dataUrl = `data:image/webp;base64,${base64}`;
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
