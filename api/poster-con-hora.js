// api/poster-con-hora.js
'use strict';

const { KV } = require('@vercel/kv');
const Jimp = require('jimp');
const fetch = require('node-fetch');
const path = require('path');

const FONT_PATH = path.join(__dirname, '../fonts/open-sans-64-white.fnt'); // Asegúrate de tener la fuente aquí

async function generarPosterConHora(nombreEvento, urlImagenOriginal, hora) {
    try {
        // Comprobar si ya existe en KV
        const cacheKey = `postersBlobHoy:${nombreEvento.toLowerCase()}`;
        const cached = await KV.get(cacheKey);
        if (cached) {
            console.log(`[Poster con hora] Usando imagen en caché para: ${nombreEvento}`);
            return cached;
        }

        console.log(`[Poster con hora] Generando imagen para: ${nombreEvento}`);
        // Cargar la imagen base
        const imagenBuffer = await fetch(urlImagenOriginal).then(res => res.buffer());
        const imagen = await Jimp.read(imagenBuffer);

        // Cargar fuente
        const fuente = await Jimp.loadFont(FONT_PATH);

        // Poner la hora en la parte superior derecha
        imagen.print(fuente, imagen.bitmap.width - 250, 10, hora);

        // Guardar en buffer
        const bufferSalida = await imagen.getBufferAsync(Jimp.MIME_PNG);

        // Guardar en KV
        const urlSalida = `data:image/png;base64,${bufferSalida.toString('base64')}`;
        await KV.set(cacheKey, urlSalida);

        return urlSalida;

    } catch (err) {
        console.error('[Poster con hora] Error al generar:', err);
        throw err;
    }
}

// Export para el API handler
module.exports = async (req, res) => {
    try {
        const { nombreEvento, urlImagen, hora } = req.query;
        if (!nombreEvento || !urlImagen || !hora) {
            return res.status(400).send('Faltan parámetros');
        }

        const poster = await generarPosterConHora(nombreEvento, urlImagen, hora);
        res.setHeader('Content-Type', 'image/png');
        const base64Data = poster.replace(/^data:image\/png;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        res.send(buffer);

    } catch (err) {
        res.status(500).send('Error al generar poster');
    }
};
