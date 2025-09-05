// index.js
const { addonBuilder, getRouter, serveHTTP } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel, loadM3U } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require('./src/config');
const bodyParser = require('body-parser');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Variable global temporal para guardar la M3U URL del usuario
let userM3uUrl = null;

// Cargar M3U por defecto al inicio
loadM3U().then(() => console.log('M3U cargado al inicio')).catch(err => console.error(err.message));

const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.150',
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
  idPrefixes: [STREAM_PREFIX],
  behaviorHints: { configurable: true }
};

const builder = new addonBuilder(manifest);

// --- Función segura para obtener la M3U actual ---
function getCurrentM3uUrl(urlFromRequest) {
  if (userM3uUrl) return userM3uUrl; // Prioriza la URL del usuario si existe
  return urlFromRequest || null; // Si no, usa la que venga del request
}

// --- Catalog handler ---
builder.defineCatalogHandler(async ({ type, id, extra, url }) => {
  if (type !== 'tv' || id !== 'Heimdallr') return { metas: [] };
  
  const cacheKey = `Heimdallr_channels_${extra?.genre || ''}_${extra?.search || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const m3uUrl = getCurrentM3uUrl(url);
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
        if (c.extra_genres?.includes(extra.genre)) return true;
        if (c.additional_streams?.some(s => s.group_title === extra.genre)) return true;
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
    cache.set(cacheKey, response, CACHE_TTL);
    return response;
  } catch (err) {
    console.error('Catalog error:', err.message);
    return { metas: [] };
  }
});

// --- Meta handler ---
builder.defineMetaHandler(async ({ type, id, url }) => {
  if (type !== 'tv' || !id.startsWith('heimdallr_')) return { meta: null };

  const channelId = id.replace('heimdallr_', '');
  const cacheKey = `meta_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    await loadM3U({ m3uUrl: getCurrentM3uUrl(url) });
    const channel = await getChannel(channelId);
    const response = { meta: { id, type: 'tv', name: channel.name, poster: channel.logo_url, background: channel.logo_url, description: channel.name } };
    cache.set(cacheKey, response, CACHE_TTL);
    return response;
  } catch (err) {
    console.error('Meta error:', err.message);
    return { meta: null };
  }
});

// --- Stream handler ---
builder.defineStreamHandler(async ({ type, id, url }) => {
  if (type !== 'tv' || !id.startsWith('heimdallr_')) return { streams: [] };

  const channelId = id.replace('heimdallr_', '');
  const cacheKey = `stream_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    await loadM3U({ m3uUrl: getCurrentM3uUrl(url) });
    const channel = await getChannel(channelId);

    const streams = [];

    const addStream = (s) => {
      const obj = { name: s.group_title || s.title, title: s.title };
      if (s.acestream_id) obj.externalUrl = `acestream://${s.acestream_id}`, obj.behaviorHints = { notWebReady: true, external: true };
      else if (s.m3u8_url || s.url || s.stream_url) obj.url = s.m3u8_url || s.url || s.stream_url, obj.behaviorHints = { notWebReady: false, external: false };
      streams.push(obj);
    };

    if (channel) {
      if (channel.acestream_id || channel.m3u8_url || channel.stream_url) addStream(channel);
      channel.additional_streams?.forEach(addStream);
      if (channel.website_url) streams.push({ title: `${channel.name} - Website`, externalUrl: channel.website_url, behaviorHints: { notWebReady: true, external: true } });
    }

    const response = { streams };
    cache.set(cacheKey, response, CACHE_TTL);
    return response;
  } catch (err) {
    console.error('Stream error:', err.message);
    return { streams: [] };
  }
});

// --- Configure UI ---
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);
router.use(bodyParser.urlencoded({ extended: false }));

router.get('/configure', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<html><body>
    <h1>Configure Heimdallr Channels</h1>
    <form action="/generate-url" method="post">
      <input type="text" name="m3uUrl" placeholder="https://example.com/list.m3u" required>
      <button type="submit">Generate Install URL</button>
    </form>
  </body></html>`);
});

router.post('/generate-url', (req, res) => {
  if (!req.body?.m3uUrl) return res.status(400).send('M3U URL required');
  userM3uUrl = req.body.m3uUrl; // Guardar temporalmente
  const baseUrl = `https://listas-sand.vercel.app/${encodeURIComponent(userM3uUrl)}/manifest.json`;
  const installUrl = `stremio://${encodeURIComponent(baseUrl)}`;
  res.setHeader('Content-Type', 'text/html');
  res.end(`<html><body>
    <p>Install URL: <a href="${installUrl}">${installUrl}</a></p>
    <p>Manifest URL: <pre>${baseUrl}</pre></p>
  </body></html>`);
});

if (process.env.NODE_ENV !== 'production') serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });

module.exports = (req, res) => {
  router(req, res, () => { res.statusCode = 404; res.end(); });
};
