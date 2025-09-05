// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel, loadM3U } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT } = require('./src/config');
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
  version: '1.2.151',
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

// ========================
// Handlers
// ========================

// Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra }, req) => {
  console.log('Catalog requested:', type, id, extra, req?.m3uUrl);

  if (type === 'tv' && id === 'Heimdallr') {
    const cacheKey = `Heimdallr_channels_${extra?.genre || ''}_${extra?.search || ''}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('Using cached catalog');
      return cached;
    }

    try {
      const m3uUrl = req?.m3uUrl || null;
      console.log('Recargando M3U desde:', m3uUrl || 'default');
      await loadM3U({ m3uUrl });

      const channels = await getChannels();
      let filteredChannels = channels;

      if (extra?.search) {
        const query = extra.search.toLowerCase();
        filteredChannels = filteredChannels.filter(c => c.name.toLowerCase().includes(query));
      }
      if (extra?.genre) {
        filteredChannels = filteredChannels.filter(c => {
          if (c.group_title === extra.genre) return true;
          if (c.additional_streams?.some(s => s.group_title === extra.genre)) return true;
          if (c.extra_genres?.includes(extra.genre)) return true;
          return false;
        });
      }

      const metas = filteredChannels.map(c => ({
        id: `heimdallr_${c.id}`,
        type: 'tv',
        name: c.name,
        poster: c.logo_url
      }));

      const response = { metas };
      cache.set(cacheKey, response);
      return response;
    } catch (err) {
      console.error('Catalog error:', err.message, err.stack);
      return { metas: [] };
    }
  }

  return { metas: [] };
});

// Meta handler
builder.defineMetaHandler(async ({ type, id }, req) => {
  console.log('Meta requested:', type, id, req?.m3uUrl);

  if (type === 'tv' && id.startsWith('heimdallr_')) {
    const channelId = id.replace('heimdallr_', '');
    const cacheKey = `meta_${channelId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const m3uUrl = req?.m3uUrl || null;
      await loadM3U({ m3uUrl });
      const channel = await getChannel(channelId);

      const response = {
        meta: {
          id,
          type: 'tv',
          name: channel.name,
          poster: channel.logo_url,
          background: channel.logo_url,
          description: channel.name
        }
      };
      cache.set(cacheKey, response);
      return response;
    } catch (err) {
      console.error('Meta error:', err.message, err.stack);
      return { meta: null };
    }
  }

  return { meta: null };
});

// Stream handler
builder.defineStreamHandler(async ({ type, id }, req) => {
  console.log('Stream requested:', type, id, req?.m3uUrl);

  if (type === 'tv' && id.startsWith('heimdallr_')) {
    const channelId = id.replace('heimdallr_', '');
    const cacheKey = `stream_${channelId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const m3uUrl = req?.m3uUrl || null;
      await loadM3U({ m3uUrl });
      const channel = await getChannel(channelId);

      const streams = [];
      if (channel.additional_streams) {
        for (const s of channel.additional_streams) {
          const obj = {
            name: s.group_title,
            title: s.title
          };
          if (s.acestream_id) {
            obj.externalUrl = `acestream://${s.acestream_id}`;
            obj.behaviorHints = { notWebReady: true, external: true };
          } else if (s.url) {
            obj.url = s.url;
          } else if (s.stream_url) {
            obj.url = s.stream_url;
          }
          streams.push(obj);
        }
      }

      if (channel.website_url) {
        streams.push({
          title: `${channel.name} - Website`,
          externalUrl: channel.website_url,
          behaviorHints: { notWebReady: true, external: true }
        });
      }

      const response = { streams };
      cache.set(cacheKey, response);
      return response;
    } catch (err) {
      console.error('Stream error:', err.message, err.stack);
      return { streams: [] };
    }
  }

  return { streams: [] };
});

// ========================
// Router & Config Pages
// ========================

const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

// Middleware: extraer m3uUrl del path
router.use((req, res, next) => {
  console.log('Middleware processing request:', req.url);
  const match = req.url.match(/^\/([^/]+)(\/(manifest\.json|catalog\/.*|meta\/.*|stream\/.*))?$/);
  if (match && match[1]) {
    req.m3uUrl = decodeURIComponent(match[1]);
    req.url = match[2] || '/manifest.json';
    console.log('Decoded m3uUrl:', req.m3uUrl);
    console.log('Modified req.url:', req.url);
  }
  next();
});

// Config page
router.use(bodyParser.urlencoded({ extended: false }));

router.get('/configure', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <!DOCTYPE html>
    <html>
      <head><title>Configure Heimdallr</title></head>
      <body>
        <h1>Configure Heimdallr Channels</h1>
        <form action="/generate-url" method="post">
          <input type="text" name="m3uUrl" placeholder="https://example.com/list.m3u" required>
          <button type="submit">Generate</button>
        </form>
      </body>
    </html>
  `);
});

router.post('/generate-url', (req, res) => {
  if (!req.body?.m3uUrl) {
    res.statusCode = 400;
    res.end('Missing m3uUrl');
    return;
  }

  const m3uUrl = req.body.m3uUrl;
  const baseUrl = `https://listas-sand.vercel.app/${encodeURIComponent(m3uUrl)}/manifest.json`;
  const installUrl = `stremio://${encodeURIComponent(baseUrl)}`;

  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <html>
      <body>
        <h1>Install Heimdallr</h1>
        <a href="${installUrl}">Install in Stremio</a>
        <p>Manifest URL:</p>
        <pre>${baseUrl}</pre>
      </body>
    </html>
  `);
});

// Explicit manifest handler
router.get('/:m3uUrl/manifest.json', (req, res) => {
  try {
    const m3uUrl = decodeURIComponent(req.params.m3uUrl);
    new URL(m3uUrl); // valida que es URL válida
    loadM3U({ m3uUrl }).then(() => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(manifest));
    }).catch(() => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to load M3U' }));
    });
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Invalid M3U URL' }));
  }
});

// ========================
// Export
// ========================

if (process.env.NODE_ENV !== 'production') {
  const { serveHTTP } = require('stremio-addon-sdk');
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

module.exports = (req, res) => {
  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
