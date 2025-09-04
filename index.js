// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel, loadM3U } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require('./src/config');
const bodyParser = require('body-parser');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Cargar M3U al inicio
loadM3U().then(() => {
  console.log('M3U cargado globalmente al inicio');
}).catch(err => {
  console.error('Error cargando M3U al inicio:', err.message);
});

const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.148', // Incrementada por correcciones
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
  console.log('extractM3uUrlFromPath called with requestUrl:', requestUrl);
  if (requestUrl) {
    try {
      const parsedUrl = new URL(requestUrl, 'http://localhost');
      const path = parsedUrl.pathname;
      console.log('Parsed path:', path);
      const match = path.match(/^\/(.+?)(?:\/(manifest\.json|catalog\/.*|meta\/.*|stream\/.*))?$/);
      if (match && match[1]) {
        const decodedUrl = decodeURIComponent(match[1]);
        console.log('Decoded m3uUrl:', decodedUrl);
        try {
          new URL(decodedUrl);
          return decodedUrl;
        } catch (e) {
          console.error('Invalid m3uUrl after decoding:', decodedUrl, e.message);
          return null;
        }
      } else {
        console.log('No match found in path:', path);
      }
    } catch (err) {
      console.error('Error parsing URL in extractM3uUrlFromPath:', err.message, err.stack);
    }
  }
  console.log('Returning null for m3uUrl');
  return null;
}

// Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra, url }) => {
  console.log('Catalog requested:', type, id, extra, url);
  if (type === 'tv' && id === 'Heimdallr') {
    const cacheKey = `Heimdallr_channels_${extra?.genre || ''}_${extra?.search || ''}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('Using cached catalog');
      return cached;
    }
    try {
      const m3uUrl = extractM3uUrlFromPath(url);
      console.log('Forzando recarga de M3U por request desde:', m3uUrl || 'default');
      await loadM3U({ m3uUrl });
      cache.set('m3u_loaded', true, CACHE_TTL);
      const channels = await getChannels();
      console.log('Fetched channels:', channels.map(c => ({ id: c.id, name: c.name, group_title: c.group_title, extra_genres: c.extra_genres })));
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
        id: `heimdallr_${channel.id}`,
        type: 'tv',
        name: channel.name,
        poster: channel.logo_url
      }));
      const response = { metas };
      cache.set(cacheKey, response);
      console.log('Catalog response:', response);
      return response;
    } catch (error) {
      console.error('Catalog error:', error.message, error.stack);
      return { metas: [] };
    }
  }
  return { metas: [] };
});

// Meta handler
builder.defineMetaHandler(async ({ type, id, url }) => {
  console.log('Meta requested:', type, id, url);
  if (type === 'tv' && id.startsWith('heimdallr_')) {
    const channelId = id.replace('heimdallr_', '');
    const cacheKey = `meta_${channelId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    try {
      const m3uUrl = extractM3uUrlFromPath(url);
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
      console.error('Meta error:', error.message, error.stack);
      return { meta: null };
    }
  }
  return { meta: null };
});

// Stream handler
builder.defineStreamHandler(async ({ type, id, url }) => {
  console.log('Stream requested:', type, id, url);
  if (type === 'tv' && id.startsWith('heimdallr_')) {
    const channelId = id.replace('heimdallr_', '');
    const cacheKey = `stream_${channelId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('Using cached streams');
      return cached;
    }
    try {
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
      console.error('Stream error:', error.message, error.stack);
      return { streams: [] };
    }
  }
  return { streams: [] };
});

// Manejar /configure y /generate-url
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

// Middleware para parsear form-urlencoded
router.use(bodyParser.urlencoded({ extended: false }));

// Manejador explícito para manifest.json
router.get('/:m3uUrl/manifest.json', (req, res) => {
  console.log('Manifest requested for m3uUrl:', req.params.m3uUrl);
  try {
    const m3uUrl = decodeURIComponent(req.params.m3uUrl);
    console.log('Decoded m3uUrl:', m3uUrl);
    // Verificar que sea una URL válida
    new URL(m3uUrl);
    // Cargar M3U para asegurar que los canales estén disponibles
    loadM3U({ m3uUrl }).then(() => {
      console.log('M3U loaded for manifest:', m3uUrl);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(manifest));
    }).catch(err => {
      console.error('Error loading M3U for manifest:', err.message, err.stack);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to load M3U for manifest' }));
    });
  } catch (err) {
    console.error('Invalid m3uUrl in manifest request:', err.message, err.stack);
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Invalid M3U URL' }));
  }
});

router.get('/configure', (req, res) => {
  console.log('Serving /configure');
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
  console.log('POST /generate-url received');
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  
  try {
    if (!req.body || !req.body.m3uUrl) {
      console.error('No m3uUrl provided or body is undefined');
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
    console.log('m3uUrl:', m3uUrl);

    const baseUrl = `https://listas-sand.vercel.app/${encodeURIComponent(m3uUrl)}/manifest.json`;
    const installUrl = `stremio://${encodeURIComponent(baseUrl)}`;
    const manifestJson = JSON.stringify(manifest, null, 2);
    console.log('baseUrl:', baseUrl);
    console.log('installUrl:', installUrl);

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
          <p>Error: ${err.message}. <a href="/configure">Go back</a></p>
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
  router(req, res, () => {
    console.log('Route not found:', req.url);
    res.statusCode = 404;
    res.end();
  });
};
