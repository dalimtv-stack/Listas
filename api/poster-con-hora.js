// api/generate-poster.js
import { put, head } from '@vercel/blob';
import sharp from 'sharp';
import Jimp from 'jimp';

export default async function handler(req, res) {
  try {
    const { imageUrl, hora } = req.query;
    if (!imageUrl || !hora) {
      return res.status(400).json({ error: 'Faltan parámetros imageUrl u hora' });
    }

    const blobName = `poster_${hora}.webp`;
    const blobUrl = `https://<tu-subdominio>.public.blob.vercel-storage.com/${blobName}`;

    // 1. Comprobar si ya existe en blob
    try {
      const exists = await head(blobName);
      if (exists) {
        return res.status(200).json({ url: blobUrl });
      }
    } catch (e) {
      // No existe → seguimos generando
    }

    // Descargar la imagen original
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error('No se pudo descargar la imagen original');
    const buffer = Buffer.from(await response.arrayBuffer());

    let finalBuffer = null;

    // 2. Intentar con Sharp
    try {
      finalBuffer = await sharp(buffer)
        .composite([
          {
            input: Buffer.from(
              `<svg>
                <text x="10" y="50" font-size="42" fill="white">${hora}</text>
              </svg>`
            ),
            top: 10,
            left: 10
          }
        ])
        .webp()
        .toBuffer();
    } catch (errSharp) {
      console.error("⚠️ Sharp falló, probando con Jimp:", errSharp.message);

      try {
        const image = await Jimp.read(buffer);
        const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
        image.print(font, 10, 10, hora);
        finalBuffer = await image.getBufferAsync(Jimp.MIME_WEBP);
      } catch (errJimp) {
        console.error("❌ Jimp también falló:", errJimp.message);
        // 3. Si todo falla → devolver original
        return res.status(200).json({ url: imageUrl });
      }
    }

    // 4. Subir a blob
    const { url } = await put(blobName, finalBuffer, { contentType: 'image/webp' });
    return res.status(200).json({ url });

  } catch (err) {
    console.error("❌ Error general:", err.message);
    return res.status(200).json({ url: req.query.imageUrl });
  }
}
