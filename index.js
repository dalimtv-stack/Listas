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
  version: '1.3',
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
        { name: 'genre', isRequired: false, options: ['Adultos','Elcano.top','Hulu.to','NEW LOOP','Noticias','Shickat.me','Telegram','Deportes','Movistar'] }
      ]
    }
  ],
  resources: ['stream','meta','catalog'],
  idPrefixes: ['heimdallr_'],
  behaviorHints: { configurable: true }
};

const builder = new addonBuilder(manifest);

// Extraer m3uUrl de la ruta
function extractM3uUrlFromPath(requestUrl) {
  if (requestUrl) {
    try {
      const parsedUrl = new URL(requestUrl, 'http://localhost');
      const path = parsedUrl.pathname;
      const match = path.match(/^\/(.+?)(\/(manifest\.json|catalog\/.*|meta\/.*|stream\/.*))?$/);
      if (match && match[1]) {
        const decodedUrl = decodeURIComponent(match[1]);
        try { new URL(decodedUrl); return decodedUrl; } 
        catch (e) { console.error('Invalid m3uUrl after decoding:', decodedUrl); return null; }
      }
    } catch (err) { console.error('Error parsing URL in extractM3uUrlFromPath:', err); }
  }
  return null;
}

// --- Catalog Handler ---
builder.defineCatalogHandler(async ({ type, id, extra, url }) => {
  if (type === 'tv' && id === 'Heimdallr') {
    const cacheKey = `Heimdallr_channels_${extra?.genre || ''}_${extra?.search || ''}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const m3uUrl = extractM3uUrlFromPath(url);
      await loadM3U({ m3uUrl });
      const channels = await getChannels();

      let filteredChannels = channels;
      if (extra?.search) filteredChannels = filteredChannels.filter(c => c.name.toLowerCase().includes(extra.search.toLowerCase()));
      if (extra?.genre) filteredChannels = filteredChannels.filter(c => c.group_title === extra.genre || (c.extra_genres && c.extra_genres.includes(extra.genre)) || (c.additional_streams?.some(s => s.group_title === extra.genre)));

      const metas = filteredChannels.map(channel => ({
        id: `heimdallr_${channel.id}`,
        type: 'tv',
        name: channel.name,
        poster: channel.logo_url
      }));

      const response = { metas };
      cache.set(cacheKey, response);
      return response;
    } catch (err) {
      console.error('Catalog error:', err);
      return { metas: [] };
    }
  }
  return { metas: [] };
});

// --- Meta Handler ---
builder.defineMetaHandler(async ({ type, id, url }) => {
  if (type === 'tv' && id.startsWith('heimdallr_')) {
    const channelId = id.replace('heimdallr_', '');
    const cacheKey = `meta_${channelId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const m3uUrl = extractM3uUrlFromPath(url);
      await loadM3U({ m3uUrl });
      const channel = await getChannel(channelId);

      const response = { meta: { id, type: 'tv', name: channel.name, poster: channel.logo_url, background: channel.logo_url, description: channel.name } };
      cache.set(cacheKey, response);
      return response;
    } catch (err) {
      console.error('Meta error:', err);
      return { meta: null };
    }
  }
  return { meta: null };
});

// --- Stream Handler ---
builder.defineStreamHandler(async ({ type, id, url }) => {
  if (type === 'tv' && id.startsWith('heimdallr_')) {
    const channelId = id.replace('heimdallr_', '');
    const cacheKey = `stream_${channelId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const m3uUrl = extractM3uUrlFromPath(url);
      await loadM3U({ m3uUrl });
      const channel = await getChannel(channelId);

      const streams = [];
      const addStream = (stream) => {
        const s = { name: stream.group_title || channel.group_title, title: stream.title || channel.name };
        if (stream.acestream_id) { s.externalUrl = `acestream://${stream.acestream_id}`; s.behaviorHints = { notWebReady:true, external:true }; }
        else if (stream.url || stream.stream_url || stream.m3u8_url) { s.url = stream.url || stream.stream_url || stream.m3u8_url; s.behaviorHints = { notWebReady:false, external:false }; }
        streams.push(s);
      };

      if (channel) addStream(channel);
      if (channel.additional_streams?.length) channel.additional_streams.forEach(addStream);
      if (channel.website_url) streams.push({ title: `${channel.name} - Website`, externalUrl: channel.website_url, behaviorHints:{ notWebReady:true, external:true }});

      const response = { streams };
      cache.set(cacheKey, response);
      return response;
    } catch (err) {
      console.error('Stream error:', err);
      return { streams: [] };
    }
  }
  return { streams: [] };
});

// --- Configure / Generate URL ---
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);
router.use(bodyParser.urlencoded({ extended: false }));

router.get('/configure', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <html>
      <body style="font-family:Arial; max-width:600px;margin:20px auto;">
        <h1>Configure Heimdallr Channels</h1>
        <form action="/generate-url" method="post">
          <input type="text" name="m3uUrl" placeholder="https://example.com/list.m3u" required>
          <button type="submit">Generate Install URL</button>
        </form>
      </body>
    </html>
  `);
});

router.post('/generate-url', (req, res) => {
  const m3uUrl = req.body?.m3uUrl;
  if (!m3uUrl) { res.status(400).end('M3U URL required'); return; }

  const baseUrl = `https://listas-sand.vercel.app/${m3uUrl}/manifest.json`;
  const installUrl = `stremio://${baseUrl}`;
  const manifestJsonEscaped = JSON.stringify(manifest, null, 2).replace(/</g,'\\u003c').replace(/>/g,'\\u003e');

  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <html>
      <body style="font-family:Arial; max-width:600px;margin:20px auto;">
        <h1>Install URL Generated</h1>
        <a href="${installUrl}" style="background:#4CAF50;color:white;padding:10px 20px;border-radius:5px;text-decoration:none;">Install Addon</a>
        <button onclick="navigator.clipboard.writeText('${baseUrl}').then(()=>alert('Manifest URL copied!'));">Copy Manifest URL</button>
        <button onclick="navigator.clipboard.writeText('${manifestJsonEscaped}').then(()=>alert('Manifest JSON copied!'));">Copy Manifest JSON</button>
        <pre>${manifestJsonEscaped}</pre>
      </body>
    </html>
  `);
});

// --- Middleware para strip prefix ---
router.use((req, res, next) => {
  const match = req.url.match(/^\/([^/]+)(\/(manifest\.json|catalog\/.*|meta\/.*|stream\/.*))?$/);
  if (match && match[1]) {
    req.m3uUrl = decodeURIComponent(match[1]);
    req.url = match[2] || '/manifest.json';
  }
  next();
});

// --- Manifest handler ---
router.get('/:m3uUrl/manifest.json', (req, res) => {
  const m3uUrl = decodeURIComponent(req.params.m3uUrl);
  try {
    new URL(m3uUrl);
    loadM3U({ m3uUrl }).then(() => {
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify(manifest));
    }).catch(err => {
      console.error('Error loading M3U for manifest:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error:'Failed to load M3U' }));
    });
  } catch (err) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error:'Invalid M3U URL' }));
  }
});

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
