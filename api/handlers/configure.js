// /api/handlers/configure.js
'use strict';

const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const { kvSetJson, kvGetJson, kvDelete } = require('../kv');
const { getM3uHash } = require('../utils');
const { getChannels, extractAndStoreGenresIfChanged } = require('../../src/db'); // Añadido para generar géneros

async function configureGet(req, res) {
  const configId = req.params.configId || null;
  let m3uUrl = '';
  let extraWebs = '';

  // Si se proporciona un configId, intentar cargar los valores actuales desde KV
  if (configId) {
    try {
      const config = await kvGetJson(configId);
      if (config) {
        m3uUrl = config.m3uUrl || '';
        extraWebs = config.extraWebs || '';
        console.log(`[CONFIGURE] Cargada configuración para configId=${configId}: m3uUrl=${m3uUrl}, extraWebs=${extraWebs}`);
      } else {
        console.warn(`[CONFIGURE] No se encontró configuración para configId=${configId}`);
      }
    } catch (e) {
      console.error(`[CONFIGURE] Error al cargar configuración para configId=${configId}:`, e.message);
    }
  }

  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Configure Heimdallr Channels</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            max-width: 600px;
            margin: 2rem auto;
            padding: 0 1rem;
            line-height: 1.6;
            color: #333;
          }
          h1 {
            font-size: 2rem;
            text-align: center;
            margin-bottom: 1.5rem;
          }
          p {
            font-size: 1.1rem;
            margin-bottom: 1rem;
          }
          form {
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }
          label {
            font-weight: 600;
            margin-bottom: 0.3rem;
          }
          input, textarea {
            padding: 0.8rem;
            font-size: 1rem;
            border: 1px solid #ccc;
            border-radius: 5px;
            width: 100%;
            box-sizing: border-box;
          }
          textarea {
            resize: vertical;
            min-height: 75px;
          }
          button {
            background: #4CAF50;
            color: white;
            padding: 0.8rem 1.5rem;
            font-size: 1rem;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            min-height: 44px;
            transition: background 0.2s;
          }
          button:hover {
            background: #45a049;
          }
          .button-group {
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
            justify-content: center;
          }
          a {
            display: inline-block;
            margin-top: 1rem;
            text-decoration: none;
            color: #4CAF50;
            font-size: 1rem;
          }
          pre {
            background: #f4f4f4;
            padding: 1rem;
            border-radius: 5px;
            font-size: 0.9rem;
            overflow-x: auto;
            margin: 1rem 0;
          }
          @media (min-width: 600px) {
            body {
              max-width: 800px;
            }
            h1 {
              font-size: 2.5rem;
            }
            p {
              font-size: 1.2rem;
            }
            input, textarea {
              font-size: 1.1rem;
              padding: 1rem;
            }
            button {
              font-size: 1.1rem;
              padding: 1rem 2rem;
            }
            .button-group {
              justify-content: flex-start;
            }
          }
          @media (max-width: 600px) {
            h1 {
              font-size: 1.5rem;
            }
            p, input, textarea, button, a {
              font-size: 0.95rem;
            }
            button, a {
              width: 100%;
              text-align: center;
            }
          }
        </style>
      </head>
      <body>
        <h1>Configure Heimdallr Channels</h1>
        <p>Enter the URL of your M3U playlist and optionally extra websites separated by ; or |:</p>
        <form action="/generate-url" method="post">
          <label for="m3uUrl">M3U Playlist URL:</label>
          <textarea name="m3uUrl" id="m3uUrl" placeholder="https://example.com/list.m3u" required>${m3uUrl}</textarea>

          <label for="extraWebs">Extra Websites:</label>
          <textarea name="extraWebs" id="extraWebs" placeholder="https://web1.com;https://web2.com">${extraWebs}</textarea>

          ${configId ? `<input type="hidden" name="configId" value="${configId}">` : ''}
          <div class="button-group">
            <button type="submit" name="action" value="generate">${configId ? 'Generate Install URL' : 'Generate Install URL'}</button>
            ${configId ? `<button type="submit" name="action" value="update">Update Configuration</button>` : ''}
          </div>
        </form>
        ${configId ? `<p>Editing configuration for ID: ${configId}</p>` : ''}
      </body>
    </html>
  `);
}

// configurePost se queda tal cual
async function configurePost(req, res) {
  try {
    const m3uUrl = String(req.body?.m3uUrl || '').trim();
    const extraWebs = String(req.body?.extraWebs || '').trim();
    const action = req.body?.action || 'generate';
    const configId = action === 'update' && req.body.configId ? req.body.configId : uuidv4();
    if (!m3uUrl) throw new Error('URL M3U requerida');

    const urlRegex = /^https?:\/\/[^\s/$.?#].[^\s]*$/;
    const extraWebsList = extraWebs ? extraWebs.split(/[;|,\n]+/).map(s => s.trim()).filter(s => urlRegex.test(s)) : [];

    // Validar la URL de la M3U
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const head = await fetch(m3uUrl, { method: 'HEAD', signal: controller.signal });
      clearTimeout(t);
      if (!head.ok) throw new Error(`HEAD ${head.status}`);
    } catch {
      const r = await fetch(m3uUrl, { method: 'GET' });
      if (!r.ok) throw new Error('La URL M3U no es accesible');
      const text = await r.text();
      if (!text.includes('#EXTINF')) throw new Error('No es un archivo M3U válido');
    }

    // Guardar la configuración en KV
    await kvSetJson(configId, { m3uUrl, extraWebs: extraWebsList.join(';') });
    console.log(`[CONFIGURE] Configuración ${action === 'update' ? 'actualizada' : 'guardada'} para configId=${configId}: m3uUrl=${m3uUrl}, extraWebs=${extraWebs}`);

    // Generar y guardar géneros después de guardar la configuración
    try {
      console.log(`[CONFIGURE] Generando géneros para configId=${configId}`);
      const channels = await getChannels({ m3uUrl });
      console.log(`[CONFIGURE] Canales cargados: ${channels.length}`);
      await extractAndStoreGenresIfChanged(channels, configId);
      console.log(`[CONFIGURE] Géneros generados y guardados para configId=${configId}`);
    } catch (genreErr) {
      console.error(`[CONFIGURE] Error al generar géneros para configId=${configId}:`, genreErr.message);
    }

    // Invalidar cachés si se está actualizando una configuración existente
    if (action === 'update') {
      const m3uHash = await getM3uHash(m3uUrl);
      await kvDelete(`m3u_hash:${configId}`);
      await kvDelete(`genres:${configId}`);
      await kvDelete(`genres_hash:${configId}`);
      await kvDelete(`last_update:${configId}`);
      await kvDelete(`stream:${m3uHash}:*`);
      await kvDelete(`scrape:*`);
      console.log(`[CONFIGURE] Cachés invalidadas para configId=${configId}`);
    }

    const baseHost = req.headers['x-forwarded-host'] || req.headers.host;
    const baseProto = req.headers['x-forwarded-proto'] || 'https';
    const manifestUrl = `${baseProto}://${baseHost}/${configId}/manifest.json`;
    const installUrl = `stremio://${encodeURIComponent(manifestUrl)}`;

    res.setHeader('Content-Type', 'text/html');
    if (action === 'update') {
      res.end(`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Configuration Updated</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; max-width: 600px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #333; }
              h1 { font-size: 2rem; text-align: center; margin-bottom: 1.5rem; }
              p { font-size: 1.1rem; margin-bottom: 1rem; }
              a { display: inline-block; background: #4CAF50; color: white; padding: 1rem 2rem; text-decoration: none; border-radius: 5px; margin: 0.5rem; min-height: 44px; text-align: center; transition: background 0.2s; }
              a:hover { background: #45a049; }
              .button-group { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: center; }
              @media (min-width: 600px) { body { max-width: 800px; } h1 { font-size: 2.5rem; } p { font-size: 1.2rem; } a { font-size: 1.1rem; } .button-group { justify-content: flex-start; } }
              @media (max-width: 600px) { h1 { font-size: 1.5rem; } p, a { font-size: 0.95rem; } a { width: 100%; } }
            </style>
          </head>
          <body>
            <h1>Configuration Updated</h1>
            <p>Your configuration has been updated for ID: ${configId}.</p>
            <p>The changes will be reflected in Stremio automatically.</p>
            <div class="button-group">
              <a href="stremio://">Back to Stremio</a>
              <a href="/${configId}/configure">Edit Configuration Again</a>
            </div>
          </body>
        </html>
      `);
    } else {
      res.end(`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Install Heimdallr Channels</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; max-width: 600px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #333; }
              h1 { font-size: 2rem; text-align: center; margin-bottom: 1.5rem; }
              p { font-size: 1.1rem; margin-bottom: 1rem; }
              button, a { display: inline-block; background: #4CAF50; color: white; padding: 1rem 2rem; font-size: 1rem; border: none; border-radius: 5px; cursor: pointer; margin: 0.5rem; min-height: 44px; text-align: center; text-decoration: none; transition: background 0.2s; }
              button:hover, a:hover { background: #45a049; }
              .button-group { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: center; }
              pre { background: #f4f4f4; padding: 1rem; border-radius: 5px; font-size: 0.9rem; overflow-x: auto; margin: 1rem 0; }
              @media (min-width: 600px) { body { max-width: 800px; } h1 { font-size: 2.5rem; } p { font-size: 1.2rem; } button, a { font-size: 1.1rem; } .button-group { justify-content: flex-start; } }
              @media (max-width: 600px) { h1 { font-size: 1.5rem; } p, button, a { font-size: 0.95rem; } button, a { width: 100%; } }
            </style>
            <script>
              function copyManifest() {
                navigator.clipboard.writeText('${manifestUrl}').then(() => {
                  alert('Manifest URL copied to clipboard!');
                }).catch(err => {
                  alert('Failed to copy: ' + err);
                });
              }
            </script>
          </head>
          <body>
            <h1>Install URL Generated</h1>
            <p>Click the buttons below to install the addon or copy the manifest URL:</p>
            <div class="button-group">
              <a href="${installUrl}">Install New Addon</a>
              <button onclick="copyManifest()">Copy New Manifest URL</button>
              <a href="/${configId}/configure">Edit Configuration</a>
            </div>
            <p>Or copy this URL:</p>
            <pre>${manifestUrl}</pre>
          </body>
        </html>
      `);
    }
  } catch (err) {
    res.setHeader('Content-Type', 'text/html');
    res.statusCode = 500;
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Server Error</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; max-width: 600px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #333; }
            h1 { font-size: 2rem; text-align: center; margin-bottom: 1.5rem; }
            p { font-size: 1.1rem; margin-bottom: 1rem; }
            a { display: inline-block; background: #4CAF50; color: white; padding: 1rem 2rem; text-decoration: none; border-radius: 5px; margin: 0.5rem; min-height: 44px; text-align: center; transition: background 0.2s; }
            a:hover { background: #45a049; }
            @media (min-width: 600px) { body { max-width: 800px; } h1 { font-size: 2.5rem; } p { font-size: 1.2rem; } a { font-size: 1.1rem; } }
            @media (max-width: 600px) { h1 { font-size: 1.5rem; } p, a { font-size: 0.95rem; } a { width: 100%; } }
          </style>
        </head>
        <body>
          <h1>Server Error</h1>
          <p>Error: ${err.message}. <a href="${req.body.configId ? `/${req.body.configId}/configure` : '/configure'}">Go back</a></p>
        </body>
      </html>
    `);
  }
}

module.exports = { configureGet, configurePost };
