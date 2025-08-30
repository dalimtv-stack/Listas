const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const crypto = require('crypto');
const { parse } = require('url');  // Para parsear req.url

// URL de la lista M3U
const M3U_URL = 'https://raw.githubusercontent.com/dalimtv-stack/Listas/main/shickat_list.m3u';

// Parsear M3U (sin cambios)
async function getChannels() {
  try {
    const response = await axios.get(M3U_URL);
    const content = response.data;
    const lines = content.split('\n');
    const channels = [];
    let current = null;
    for (let line of lines) {
      line = line.trim();
      if (line.startsWith('#EXTINF:')) {
        const nameMatch = line.match(/,(.+)$/);
        const name = nameMatch ? nameMatch[1].trim() : 'Unknown Channel';
        const tvgLogo = line.match(/tvg-logo="([^"]+)"/);
        const logo = tvgLogo ? tvgLogo[1] : null;
        current = { name, logo };
      } else if (line && !line.startsWith('#') && current) {
        if (line.startsWith('acestream://')) {
          current.url = line;
          current.id = crypto.createHash('md5').update(line).digest('hex');
          channels.push(current);
        }
        current = null;
      }
    }
    return channels;
  } catch (error) {
    console.error('Error fetching M3U:', error);
    return [];
  }
}

// Cache de canales
let cachedChannels = [];
async function refreshChannels() {
  cachedChannels = await getChannels();
  return cachedChannels;
}

// Manifest (sin cambios)
const manifest = {
  id: 'org.stremio.shickatacestream',
  version: '1.0.0',
  name: 'Shickat Acestream Channels',
  description: 'Addon para cargar canales Acestream desde una lista M3U específica.',
  resources: ['catalog', 'meta', 'stream'],
  types: ['channel'],
  catalogs: [
    {
      type: 'channel',
      id: 'shickat-channels',
      name: 'Shickat Channels',
      extra: [{ name: 'search', isRequired: false }]
    }
  ],
  idPrefixes: ['shickat:']
};

// Builder y handlers (sin cambios)
const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async function(args) {
  if (cachedChannels.length === 0) {
    await refreshChannels();
  }
  let metas = cachedChannels.map(channel => ({
    id: 'shickat:' + channel.id,
    type: 'channel',
    name: channel.name,
    poster: channel.logo || 'https://via.placeholder.com/300x450?text=' + encodeURIComponent(channel.name)
  }));

  if (args.extra && args.extra.search) {
    const searchTerm = args.extra.search.toLowerCase();
    metas = metas.filter(meta => meta.name.toLowerCase().includes(searchTerm));
  }

  return { metas };
});

builder.defineMetaHandler(async function(args) {
  if (cachedChannels.length === 0) {
    await refreshChannels();
  }
  const id = args.id.replace('shickat:', '');
  const channel = cachedChannels.find(ch => ch.id === id);
  if (channel) {
    return {
      id: args.id,
      type: 'channel',
      name: channel.name,
      poster: channel.logo,
      description: 'Canal Acestream desde lista Shickat.',
      background: channel.logo,
      logo: channel.logo
    };
  }
  return {};
});

builder.defineStreamHandler(async function(args) {
  if (cachedChannels.length === 0) {
    await refreshChannels();
  }
  const id = args.id.replace('shickat:', '');
  const channel = cachedChannels.find(ch => ch.id === id);
  if (channel) {
    return {
      streams: [
        {
          url: channel.url,
          title: channel.name,
          behaviorHints: {
            notWebReady: true,
            isExternal: true
          }
        }
      ]
    };
  }
  return { streams: [] };
});

// Obtener la interfaz del SDK
const addonInterface = builder.getInterface();

// Handler para Vercel Serverless: Parsea req y delega al SDK
module.exports = async (req, res) => {
  const parsedUrl = parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Manejar /manifest.json explícitamente
  if (pathname === '/manifest.json') {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).end(JSON.stringify(manifest));
    return;
  }

  // Para otras rutas, usa el SDK (catálogo, meta, stream, etc.)
  // El SDK espera un req/res compatibles, así que delega
  try {
    const response = await addonInterface(req, res);
    if (response) {
      // Si el SDK ya envió la respuesta, no hagas nada más
      return;
    }
  } catch (error) {
    console.error('Error en handler:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }

  // Fallback si no se maneja
  res.status(404).json({ error: 'Not Found' });
};
