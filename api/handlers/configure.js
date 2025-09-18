// api/handlers/configure.js
'use strict';

const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const { kvSetJson, kvGetJson, kvDelete } = require('../kv');
const { getM3uHash } = require('../utils');
const { getChannels } = require('../../src/db');
const { extractAndStoreGenresIfChanged } = require('./catalog');

async function configureGet(req, res) {
  const configId = req.params.configId || null;
  let m3uUrl = '';
  let extraWebs = '';

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
            margin: 20px auto;
            padding: 0 10px;
            color: #333;
          }
          h1 {
            font-size: 1.8rem;
            text-align: center;
            margin-bottom: 20px;
          }
          p {
            font-size: 1rem;
            margin-bottom: 10px;
          }
          form {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          input {
            padding: 10px;
            font-size: 1rem;
            border: 1px solid #ccc;
            border-radius: 5px;
            width: 100%;
            box-sizing: border-box;
          }
          button {
            background: #4CAF50;
            color: white;
            padding: 10px;
            font-size: 1rem;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            transition: background 0.2s;
          }
          button:hover {
            background: #45a049;
          }
          .button-group {
            display: flex;
            gap: 10px;
            justify-content: center;
          }
          @media (max-width: 600px) {
            h1 {
              font-size: 1.5rem;
            }
            p, input, button {
              font-size: 0.9rem;
            }
            input, button {
              padding: 8px;
            }
          }
        </style>
      </head>
      <body>
        <h1>Configure Heimdallr Channels</h1>
        <p>Enter the URL of your M3U playlist and optionally extra websites separated by ; or |:</p>
        <form action="/generate-url" method="post">
          <input type="text" name="m3uUrl" placeholder="https://example.com/list.m3u" value="${m3uUrl}" required>
          <input type="text" name="extraWebs" placeholder="https://web1.com;https://web2.com" value="${extraWebs}">
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

async function configurePost(req, res) {
  try {
    const m3uUrl = String(req.body?.m3uUrl || '').trim();
    const extraWebs = String(req.body?.extraWebs || '').trim();
    const action = req.body?.action || 'generate';
    const configId = action === 'update' && req.body.configId ? req.body.configId : uuidv4();
    if (!m3uUrl) throw new Error('URL M3U requerida');

    const urlRegex = /^https?:\/\/[^\s/$.?#].[^\s]*$/;
    const extraWebsList = extraWebs ? extraWebs.split(/[;|,\n]+/).map(s => s.trim()).filter(s => urlRegex.test(s)) : [];

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

    await kvSetJson(configId, { m3uUrl, extraWebs: extraWebsList.join(';') });
    console.log(`[CONFIGURE] Configuración ${action === 'update' ? 'actualizada' : 'guardada'} para configId=${configId}: m3uUrl=${m3uUrl}, extraWebs=${extraWebs}`);

    try {
      console.log(`[CONFIGURE] Generando géneros para configId=${configId}`);
      const channels = await getChannels({ m3uUrl });
      console.log(`[CONFIGURE] Canales cargados: ${channels.length}`);
      await extractAndStoreGenresIfChanged(channels, configId);
      console.log(`[CONFIGURE] Géneros generados y guardados para configId=${configId}`);
    } catch (genreErr) {
      console.error(`[CONFIGURE] Error al generar géneros para configId=${configId}:`, genreErr.message);
    }

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
    const timestamp = Date.now();
    const manifestUrl = `${baseProto}://${baseHost}/${configId}/manifest.json?t=${timestamp}`;
    const installUrl = `stremio://${encodeURIComponent(manifestUrl)}`;

    res.setHeader('Content-Type', 'text/html');
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${action === 'update' ? 'Configuration Updated' : 'Install Heimdallr Channels'}</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
              max-width: 600px;
              margin: 20px auto;
              padding: 0 10px;
              color: #333;
            }
            h1 {
              font-size: 1.8rem;
              text-align: center;
              margin-bottom: 20px;
            }
            p {
              font-size: 1rem;
              margin-bottom: 10px;
            }
            a, button {
              display: inline-block;
              background: #4CAF50;
              color: white;
              padding: 10px;
              font-size: 1rem;
              border: none;
              border-radius: 5px;
              cursor: pointer;
              text-decoration: none;
              margin: 5px;
              transition: background 0.2s;
            }
            a:hover, button:hover {
              background: #45a049;
            }
            .button-group {
              display: flex;
              gap: 10px;
              justify-content: center;
            }
            pre {
              background: #f4f4f4;
              padding: 10px;
              border-radius: 5px;
              font-size: 0.9rem;
              overflow-x: auto;
              margin: 10px 0;
            }
            @media (max-width: 600px) {
              h1 {
                font-size: 1.5rem;
              }
              p, a, button {
                font-size: 0.9rem;
              }
              a, button {
                padding: 8px;
                width: 100%;
                text-align: center;
              }
            }
          </style>
          ${action !== 'update' ? `
          <script>
            function copyManifest() {
              navigator.clipboard.writeText('${manifestUrl}').then(() => {
                alert('Manifest URL copied to clipboard!');
              }).catch(err => {
                alert('Failed to copy: ' + err);
              });
            }
          </script>
          ` : ''}
        </head>
        <body>
          <h1>${action === 'update' ? 'Configuration Updated' : 'Install URL Generated'}</h1>
          ${action === 'update' ? `
          <p>Your configuration has been updated for ID: ${configId}.</p>
          <p>The changes will be reflected in Stremio automatically.</p>
          <div class="button-group">
            <a href="stremio://">Back to Stremio</a>
            <a href="/${configId}/configure">Edit Configuration Again</a>
          </div>
          ` : `
          <p>Click the buttons below to install the addon or copy the manifest URL:</p>
          <div class="button-group">
            <a href="${installUrl}">Install New Addon</a>
            <button onclick="copyManifest()">Copy New Manifest URL</button>
            <a href="/${configId}/configure">Edit Configuration</a>
          </div>
          <p>Or copy this URL:</p>
          <pre>${manifestUrl}</pre>
          `}
        </body>
      </html>
    `);
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
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
              max-width: 600px;
              margin: 20px auto;
              padding: 0 10px;
              color: #333;
            }
            h1 {
              font-size: 1.8rem;
              text-align: center;
              margin-bottom: 20px;
            }
            p {
              font-size: 1rem;
              margin-bottom: 10px;
            }
            a {
              display: inline-block;
              background: #4CAF50;
              color: white;
              padding: 10px;
              font-size: 1rem;
              border: none;
              border-radius: 5px;
              text-decoration: none;
              margin: 5px;
              transition: background 0.2s;
            }
            a:hover {
              background: #45a049;
            }
            @media (max-width: 600px) {
              h1 {
                font-size: 1.5rem;
              }
              p, a {
                font-size: 0.9rem;
              }
              a {
                padding: 8px;
                width: 100%;
                text-align: center;
              }
            }
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
