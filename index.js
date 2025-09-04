// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel, loadM3U } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require('./src/config');
const bodyParser = require('body-parser');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Cargar M3U al inicio con URL por defecto
loadM3U().then(() => {
  console.log('M3U cargado globalmente al inicio');
}).catch(err => {
  console.error('Error cargando M3U al inicio:', err.message);
});

const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.144', // incrementada (fix /configure robusto)
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
  idPrefixes: [STREAM_PREFIX],
  behaviorHints: {
    configurable: true
  }
};

const builder = new addonBuilder(manifest);

// Extraer m3uUrl de la ruta
function extractM3uUrlFromPath(requestUrl) {
  if (requestUrl) {
    try {
      const path = new URL(requestUrl, 'http://localhost').pathname;
      const match = path.match(/^\/(.+?)(\/manifest\.json|\/catalog\/.*|\/meta\/.*|\/stream\/.*)?$/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
    } catch (err) {
      console.error('Error parsing URL in extractM3uUrlFromPath:', err.message);
    }
  }
  return null;
}

// Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra, url: requestUrl }) => {
  console.log('Catalog requested:', type, id, extra, requestUrl);

  if (type === 'tv' && id === 'Heimdallr') {
    const cacheKey = `Heimdallr_channels_${extra?.genre || ''}_${extra?.search || ''}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      console.log('Using cached catalog');
      return cached;
    }

    try {
      const m3uUrl = extractM3uUrlFromPath(requestUrl);
      console.log('Forzando recarga de M3U por request desde:', m3uUrl || 'default');
      await loadM3U({ m3uUrl });
      cache.set('m3u_loaded', true, CACHE_TTL);

      const channels = await getChannels();
      console.log('Fetched channels with group_titles:', channels.map(c => ({ id: c.id, name: c.name, group_title: c.group_title, extra_genres: c.extra_genres })));

      let filteredChannels = channels;

      if (extra?.search) {
        const query = extra.search.toLowerCase();
        filteredChannels = filteredChannels.filter(channel => channel.name.toLowerCase().includes(query));
      }

      if (extra?.genre) {
        filteredChannels = filteredChannels.filter(channel => {
          if (channel.group_title === extra.genre) return true;
          if (channel.additional_streams && Array.isArray(channel.additional_streams)) {
            if (channel.additional_streams.some(stream => stream.group_title === extra.genre)) return true;
          }
          if (channel.extra_genres && Array.isArray(channel.extra_genres)) {
            if (channel.extra_genres.includes(extra.genre)) return true;
          }
          return false;
        });
      }

      const metas = filteredChannels.map(channel => ({
        id: `${STREAM_PREFIX}${channel.id}`,
        type: 'tv',
        name: channel.name,
        poster: channel.logo_url
      }));

      const response = { metas };
      cache.set(cacheKey, response);
      return response;
    } catch (error) {
      console.error('Catalog error:', error.message);
      return { metas: [] };
    }
  }
  return { metas: [] };
});

// Meta handler
builder.defineMetaHandler(async ({ type, id, url: requestUrl }) => {
  console.log('Meta requested:', type, id, requestUrl);

  if (type === 'tv' && id.startsWith(STREAM_PREFIX)) {
    const channelId = id.replace(STREAM_PREFIX, '');
    const cacheKey = `meta_${channelId}`;
    const cached = cache.get(cacheKey);

    if (cached) return cached;

    try {
      const m3uUrl = extractM3uUrlFromPath(requestUrl);
      await loadM3U({ m3uUrl });
      const channel = await getChannel(channelId);
      const response = {
        meta: {
          id: id,
          type: 'tv',
          name: channel.name,
          poster: channel.logo_url,
          background: channel.logo_url,
          description: channel.name
        }
      };
      cache.set(cacheKey, response);
      return response;
    } catch (error) {
      console.error('Meta error:', error.message);
      return { meta: null };
    }
  }
  return { meta: null };
});

// Stream handler
builder.defineStreamHandler(async ({ type, id, url: requestUrl }) => {
  console.log('Stream requested:', type, id, requestUrl);

  if (type === 'tv' && id.startsWith(STREAM_PREFIX)) {
    const channelId = id.replace(STREAM_PREFIX, '');
    const cacheKey = `stream_${channelId}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      console.log('Using cached streams');
      return cached;
    }

    try {
      const m3uUrl = extractM3uUrlFromPath(requestUrl);
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

      if (channel.additional_streams && Array.isArray(channel.additional_streams)) {
        channel.additional_streams.forEach((stream) => {
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

      console.log('Streams generated:', streams);
      const response = { streams };
      cache.set(cacheKey, response);
      return response;
    } catch (error) {
      console.error('Stream error:', error.message);
      return { streams: [] };
    }
  }
  return { streams: [] };
});

// Manejar /configure y /generate-url
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

// Middleware para parsear form-urlencoded (necesario para /generate-url)
router.use(bodyParser.urlencoded({ extended: false }));

// /configure: dos botones (Instalar + Copiar JSON), con fallbacks robustos
router.get('/configure', (req, res) => {
  console.log('Serving /configure');

  const host = req.get('host') || 'listas-sand.vercel.app';
  const protocol = req.protocol || 'https';
  const baseUrl = `${protocol}://${host}/manifest.json`;
  const installUrl = `stremio://${encodeURIComponent(baseUrl)}`;
  const manifestJson = JSON.stringify(manifest, null, 2);

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Configurar Heimdallr Channels</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { font-family: Arial, sans-serif; max-width: 640px; margin: 32px auto; text-align: center; padding: 0 16px; }
          .btn { display: inline-block; padding: 12px 18px; margin: 10px; font-size: 16px; border: none; border-radius: 8px; cursor: pointer; text-decoration: none; }
          .install { background: #4CAF50; color: #fff; }
          .copy { background: #2196F3; color: #fff; }
        </style>
        <script>
          function copyManifest() {
            const text = ${JSON.stringify(manifestJson)};
            navigator.clipboard.writeText(text)
              .then(() => alert('Manifest JSON copiado al portapapeles'))
              .catch(err => alert('Error al copiar: ' + err));
          }
        </script>
      </head>
      <body>
        <h1>Heimdallr Channels</h1>
        <p>Instala el addon o copia el <code>manifest.json</code>:</p>
        <a class="btn install" href="${installUrl}">📥 Instalar en Stremio</a>
        <button class="btn copy" onclick="copyManifest()">📋 Copiar JSON</button>
      </body>
    </html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.end(html);
});

router.post('/generate-url', (req, res) => {
  console.log('POST /generate-url received with headers:', req.headers);
  console.log('POST /generate-url body:', req.body);
  try {
    if (!req.body) {
      throw new Error('Request body is undefined or empty');
    }
    const m3uUrl = req.body.m3uUrl;
    console.log('m3uUrl received:', m3uUrl);

    if (!m3uUrl) {
      console.error('No m3uUrl provided in POST body');
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

    // Construir baseUrl de forma robusta
    const host = req.get('host') || 'listas-sand.vercel.app';
    const protocol = req.protocol || 'https';
    const encodedUrl = encodeURIComponent(m3uUrl);
    const baseUrl = `${protocol}://${host}/${encodedUrl}/manifest.json`;
    const installUrl = `stremio://${encodeURIComponent(baseUrl)}`;
    const manifestJson = JSON.stringify(manifest, null, 2);
    console.log('Generated baseUrl:', baseUrl);
    console.log('Generated installUrl:', installUrl);

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
              const manifestText = ${JSON.stringify(manifestJson)};
              navigator.clipboard.writeText(manifestText).then(() => {
                alert('Manifest JSON copied to clipboard!');
              }).catch(err => {
                alert('Failed to copy: ' + err);
              });
            }
          </script>
        </head>
        <body>
          <h1>Install URL Generated</h1>
          <p>Click the buttons below to install the addon or copy the manifest JSON:</p>
          <a href="${installUrl}" style="background: #4CAF50; color: white; padding: 10px 20px; border-radius: 5px;">Install Addon</a>
          <button onclick="copyManifest()">Copy Manifest JSON</button>
          <p>Or copy this URL:</p>
          <pre>${baseUrl}</pre>
          <p>Manifest JSON:</p>
          <pre>${manifestJson}</pre>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Error in /generate-url:', err.message, err.stack);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html');
    res.end(`
      <html>
        <body>
          <h1>Server Error</h1>
          <p>An error occurred while processing the request: ${err.message}. <a href="/configure">Go back</a></p>
        </body>
      </html>
    `);
  }
});

if (process.env.NODE_ENV !== 'production') {
  const { serveHTTP } = require('stremio-addon-sdk');
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

module.exports = (req, res) => {
  console.log('Request received:', req.url);
  const addonInterface = builder.getInterface();
  const router = getRouter(addonInterface);
  router.use(bodyParser.urlencoded({ extended: false }));
  router(req, res, () => {
    console.log('Route not found:', req.url);
    res.statusCode = 404;
    res.end();
  });
};
