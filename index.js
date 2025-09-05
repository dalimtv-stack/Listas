// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel, loadM3U } = require('./src/db');
const bodyParser = require('body-parser');

const cache = new NodeCache({ stdTTL: 3600 });

// Cargar M3U al inicio
loadM3U().then(() => {
  console.log('[startup] M3U cargado globalmente al inicio');
}).catch(err => {
  console.error('[startup] Error cargando M3U al inicio:', err.message);
});

const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.152',
  name: 'Heimdallr Channels',
  description: 'Addon para cargar canales Acestream o M3U8 desde una lista M3U proporcionada por el usuario.',
  types: ['tv'],
  logo: 'https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960',
  catalogs: [
    {
      type: 'tv',
      id: 'Heimdallr',
      name: 'Heimdallr Live Channels',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'genre', isRequired: false, options: ['Adultos', 'Elcano.top', 'Hulu.to', 'NEW LOOP', 'Noticias', 'Shickat.me', 'Telegram', 'Deportes', 'Movistar'] }
      ]
    }
  ],
  resources: ['stream', 'meta', 'catalog'],
  idPrefixes: ['heimdallr_'],
  behaviorHints: {
    configurable: true
  }
};

const builder = new addonBuilder(manifest);

// Extraer m3uUrl de la ruta
function extractM3uUrlFromPath(requestUrl) {
  console.log(`[extractM3uUrl] Procesando URL: ${requestUrl}`);
  if (!requestUrl) {
    console.log('[extractM3uUrl] No se proporcionó URL, usando default');
    return null;
  }
  try {
    const parsedUrl = new URL(requestUrl, 'http://localhost');
    const path = parsedUrl.pathname;
    console.log(`[extractM3uUrl] Path parseado: ${path}`);
    const match = path.match(/^\/(.+?)(\/(manifest\.json|catalog\/.*|meta\/.*|stream\/.*))?$/);
    if (match && match[1]) {
      const decodedUrl = decodeURIComponent(match[1]);
      console.log(`[extractM3uUrl] Decoded m3uUrl: ${decodedUrl}`);
      try {
        new URL(decodedUrl);
        return decodedUrl;
      } catch (e) {
        console.error(`[extractM3uUrl] URL inválida: ${decodedUrl}`, e.message);
        return null;
      }
    }
    console.log(`[extractM3uUrl] No se encontró prefijo M3U en: ${path}`);
    return null;
  } catch (err) {
    console.error(`[extractM3uUrl] Error parseando URL: ${err.message}`);
    return null;
  }
}

// Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra, url }) => {
  console.log(`[catalogHandler] Solicitud: type=${type}, id=${id}, extra=${JSON.stringify(extra)}, url=${url}`);
  if (type !== 'tv' || id !== 'Heimdallr') {
    console.log('[catalogHandler] Solicitud no válida, retornando vacío');
    return { metas: [] };
  }
  try {
    const m3uUrl = extractM3uUrlFromPath(url);
    console.log(`[catalogHandler] Cargando M3U desde: ${m3uUrl || 'default'}`);
    await loadM3U({ m3uUrl });
    const channels = await getChannels();
    console.log(`[catalogHandler] Canales obtenidos: ${channels.length}`);
    let filteredChannels = channels;
    if (extra?.search) {
      const query = extra.search.toLowerCase();
      filteredChannels = filteredChannels.filter(channel => channel.name.toLowerCase().includes(query));
      console.log(`[catalogHandler] Filtrado por búsqueda: ${filteredChannels.length} canales`);
    }
    if (extra?.genre) {
      filteredChannels = filteredChannels.filter(channel => {
        if (channel.group_title === extra.genre) return true;
        if (channel.additional_streams?.some(stream => stream.group_title === extra.genre)) return true;
        if (channel.extra_genres?.includes(extra.genre)) return true;
        return false;
      });
      console.log(`[catalogHandler] Filtrado por género: ${filteredChannels.length} canales`);
    }
    const metas = filteredChannels.map(channel => ({
      id: `heimdallr_${channel.id}`,
      type: 'tv',
      name: channel.name,
      poster: channel.logo_url
    }));
    console.log(`[catalogHandler] Respuesta: metas.length=${metas.length}`);
    return { metas };
  } catch (error) {
    console.error(`[catalogHandler] Error: ${error.message}`, error.stack);
    return { metas: [] };
  }
});

// Meta handler
builder.defineMetaHandler(async ({ type, id, url }) => {
  console.log(`[metaHandler] Solicitud: type=${type}, id=${id}, url=${url}`);
  if (type !== 'tv' || !id.startsWith('heimdallr_')) {
    return { meta: null };
  }
  try {
    const channelId = id.replace('heimdallr_', '');
    const m3uUrl = extractM3uUrlFromPath(url);
    await loadM3U({ m3uUrl });
    const channel = await getChannel(channelId);
    return {
      meta: {
        id,
        type: 'tv',
        name: channel.name,
        poster: channel.logo_url,
        background: channel.logo_url,
        description: channel.name
      }
    };
  } catch (error) {
    console.error(`[metaHandler] Error: ${error.message}`, error.stack);
    return { meta: null };
  }
});

// Stream handler
builder.defineStreamHandler(async ({ type, id, url }) => {
  console.log(`[streamHandler] Solicitud: type=${type}, id=${id}, url=${url}`);
  if (type !== 'tv' || !id.startsWith('heimdallr_')) {
    return { streams: [] };
  }
  try {
    const channelId = id.replace('heimdallr_', '');
    const m3uUrl = extractM3uUrlFromPath(url);
    await loadM3U({ m3uUrl });
    const channel = await getChannel(channelId);
    const streams = [];
    if (channel.acestream_id || channel.m3u8_url || channel.stream_url) {
      const streamObj = {
        name: channel.additional_streams.length > 0 ? channel.additional_streams[0].group_title : channel.group_title,
        title: channel.title
      };
      if (channel.acestream_id) {
        streamObj.externalUrl = `acestream://${channel.acestream_id}`;
        streamObj.behaviorHints = { notWebReady: true, external: true };
      } else if (channel.m3u8_url) {
        streamObj.url = channel.m3u8_url;
        streamObj.behaviorHints = { notWebReady: false, external: false };
      } else if (channel.stream_url) {
        streamObj.url = channel.stream_url;
        streamObj.behaviorHints = { notWebReady: false, external: false };
      }
      streams.push(streamObj);
    }
    if (channel.additional_streams?.length) {
      channel.additional_streams.forEach(stream => {
        const streamObj = {
          name: stream.group_title,
          title: stream.title
        };
        if (stream.acestream_id) {
          streamObj.externalUrl = `acestream://${stream.acestream_id}`;
          streamObj.behaviorHints = { notWebReady: true, external: true };
        } else if (stream.url) {
          streamObj.url = stream.url;
          streamObj.behaviorHints = { notWebReady: false, external: false };
        } else if (stream.stream_url) {
          streamObj.url = stream.stream_url;
          streamObj.behaviorHints = { notWebReady: false, external: false };
        }
        streams.push(streamObj);
      });
    }
    if (channel.website_url) {
      streams.push({
        title: `${channel.name} - Website`,
        externalUrl: channel.website_url,
        behaviorHints: { notWebReady: true, external: true }
      });
    }
    console.log(`[streamHandler] Streams generados: ${streams.length}`);
    return { streams };
  } catch (error) {
    console.error(`[streamHandler] Error: ${error.message}`, error.stack);
    return { streams: [] };
  }
});

// Configuración del router
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

// Middleware para parsear form-urlencoded
router.use(bodyParser.urlencoded({ extended: false }));

// Rutas estáticas
router.get('/configure', (req, res) => {
  console.log('[router] Serving /configure');
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
        <p>Enter the URL of your M3U playlist:</p>
        <form action="/generate-url" method="post">
          <input type="text" name="m3uUrl" placeholder="https://example.com/list.m3u" required>
          <button type="submit">Generate Install URL</button>
        </form>
      </body>
    </html>
  `);
});

router.post('/generate-url', (req, res) => {
  console.log('[router] POST /generate-url', { body: req.body });
  try {
    if (!req.body?.m3uUrl) {
      console.error('[router] No m3uUrl provided');
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/html');
      res.end(`
        <html>
          <body>
            <h1>Error</h1>
            <p>M3U URL is required. <a href="/configure">Go back</a></p>
          </body>
        </html>
      `);
      return;
    }

    const m3uUrl = req.body.m3uUrl;
    console.log(`[router] m3uUrl: ${m3uUrl}`);
    const baseUrl = `https://listas-sand.vercel.app/${encodeURIComponent(m3uUrl)}/manifest.json`;
    const installUrl = `stremio://${encodeURIComponent(baseUrl)}`;
    console.log(`[router] baseUrl: ${baseUrl}, installUrl: ${installUrl}`);

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
              navigator.clipboard.writeText('${baseUrl}').then(() => {
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
          <pre>${baseUrl}</pre>
          <p>Manifest JSON:</p>
          <pre>${JSON.stringify(manifest, null, 2)}</pre>
        </body>
      </html>
    `);
  } catch (err) {
    console.error(`[router] Error in /generate-url: ${err.message}`, err.stack);
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
});

// Middleware para manejar URLs con prefijo M3U
router.use((req, res, next) => {
  console.log(`[middleware] Procesando: ${req.url}`);
  const match = req.url.match(/^\/([^/]+)(\/(manifest\.json|catalog\/.*|meta\/.*|stream\/.*))?$/);
  if (match && match[1]) {
    req.m3uUrl = decodeURIComponent(match[1]);
    req.url = match[2] || '/manifest.json';
    console.log(`[middleware] m3uUrl: ${req.m3uUrl}, nuevo req.url: ${req.url}`);
  } else {
    console.log(`[middleware] Sin prefijo M3U, URL original: ${req.url}`);
  }
  next();
});

// Manejador explícito para manifest.json
router.get('/:m3uUrl/manifest.json', async (req, res) => {
  console.log(`[router] Manifest solicitado para m3uUrl: ${req.params.m3uUrl}`);
  try {
    const m3uUrl = decodeURIComponent(req.params.m3uUrl);
    console.log(`[router] Decoded m3uUrl: ${m3uUrl}`);
    new URL(m3uUrl);
    await loadM3U({ m3uUrl });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(manifest));
  } catch (err) {
    console.error(`[router] Error en manifest: ${err.message}`, err.stack);
    res.statusCode = err.message.includes('Invalid URL') ? 400 : 500;
    res.end(JSON.stringify({ error: 'Failed to load M3U for manifest' }));
  }
});

if (process.env.NODE_ENV !== 'production') {
  const { serveHTTP } = require('stremio-addon-sdk');
  serveHTTP(addonInterface, { port: process.env.PORT || 3000 });
}

module.exports = (req, res) => {
  console.log(`[server] Solicitud recibida: ${req.url}`);
  router(req, res, () => {
    console.log(`[server] Ruta no encontrada: ${req.url}`);
    res.statusCode = 404;
    res.end();
  });
};
