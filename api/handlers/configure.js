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
    <html>
      <head>
        <title>Configure Heimdallr Channels</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; }
          input { width: 100%; padding: 10px; margin: 10px 0; }
          button { background: #4CAF50; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin-right: 10px; }
          a { display: inline-block; margin-top: 20px; text-decoration: none; color: #4CAF50; }
          pre { background: #f4f4f4; padding: 10px; border-radius: 5px; }
        </style>
      </head>
      <body>
        <h1>Configure Heimdallr Channels</h1>
        <p>Enter the URL of your M3U playlist and optionally extra websites separated by ; or |:</p>
        <form action="/generate-url" method="post">
          <input type="text" name="m3uUrl" placeholder="https://example.com/list.m3u" value="${m3uUrl}" required>
          <input type="text" name="extraWebs" placeholder="https://web1.com;https://web2.com" value="${extraWebs}">
          <button type="submit">Generate Install URL</button>
        </form>
      </body>
    </html>
  `);
}

async function configurePost(req, res) {
  try {
    const m3uUrl = String(req.body?.m3uUrl || '').trim();
    const extraWebs = String(req.body?.extraWebs || '').trim();
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

    const configId = uuidv4();
    await kvSetJson(configId, { m3uUrl, extraWebs: extraWebsList.join(';') });

    try {
      const channels = await getChannels({ m3uUrl });
      await extractAndStoreGenresIfChanged(channels, configId);
    } catch (e) {
      console.error('Error generating genres:', e);
    }

    const baseHost = req.headers['x-forwarded-host'] || req.headers.host;
    const baseProto = req.headers['x-forwarded-proto'] || 'https';
    const manifestUrl = `${baseProto}://${baseHost}/${configId}/manifest.json`;
    const installUrl = `stremio://${encodeURIComponent(manifestUrl)}`;

    res.setHeader('Content-Type', 'text/html');
    res.end(`
      <html>
        <head>
          <title>Install Heimdallr Channels</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; }
            button { background: #4CAF50; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin-right: 10px; }
            a { display: inline-block; margin-top: 20px; text-decoration: none; color: #4CAF50; }
            pre { background: #f4f4f4; padding: 10px; border-radius: 5px; }
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
          <a href="${installUrl}" style="background: #4CAF50; color: white; padding: 10px 20px; border-radius: 5px;">Install Addon</a>
          <button onclick="copyManifest()">Copy Manifest URL</button>
          <p>Or copy this URL:</p>
          <pre>${manifestUrl}</pre>
        </body>
      </html>
    `);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html');
    res.end(`
      <html>
        <body>
          <h1>Server Error</h1>
          <p>Error: ${err.message}. <a href="/configure">Go back</a></p>
        </body>
      </html>
    `);
  }
}

module.exports = { configureGet, configurePost };
