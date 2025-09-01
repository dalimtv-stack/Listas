const { addonBuilder, getRouter, serveHTTP } = require("stremio-addon-sdk");
const NodeCache = require("node-cache");
const { getChannels, getChannel } = require("./src/db");
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require("./src/config");
require("dotenv").config();

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Manifest con configuración y botón "Configurar"
const manifest = {
  id: "org.stremio.Heimdallr",
  version: "1.4.0",
  name: "Heimdallr Channels",
  description:
    "Addon para cargar canales Acestream o M3U8 desde una lista M3U configurable por el usuario.",
  types: ["tv"],
  logo:
    "https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960",
  catalogs: [
    {
      type: "tv",
      id: "Heimdallr",
      name: "Heimdallr Live Channels",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    }
  ],
  resources: ["catalog", "meta", "stream"],
  idPrefixes: [STREAM_PREFIX],
  // 🔑 Esto hace que aparezca el botón "Configurar" en Stremio
  behaviorHints: { configurable: true, configurationRequired: false },
  // 🔑 Formulario de configuración generado por el SDK
  config: [
    {
      key: "m3u_url",
      type: "text",
      title: "M3U URL",
      description:
        "Introduce la URL de la lista M3U (p.ej. https://tuservidor/Lista.m3u)",
      required: false,
      default:
        "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u"
    }
  ]
};

const builder = new addonBuilder(manifest);

// ------- Catalog -------
builder.defineCatalogHandler(async ({ type, id, config }) => {
  if (type !== "tv" || id !== "Heimdallr") return { metas: [] };

  const m3uUrl = (config && config.m3u_url) || manifest.config[0].default;
  const cacheKey = `catalog_${id}_${m3uUrl}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channels = await getChannels(m3uUrl);
    const metas = channels.map((channel) => ({
      id: `${STREAM_PREFIX}${channel.id}`,
      type: "tv",
      name: `${channel.group_title} · ${channel.name}`,
      poster: channel.logo_url
    }));
    const response = { metas };
    cache.set(cacheKey, response);
    return response;
  } catch (err) {
    console.error("Catalog error:", err);
    return { metas: [] };
  }
});

// ------- Meta -------
builder.defineMetaHandler(async ({ type, id, config }) => {
  if (type !== "tv" || !id.startsWith(STREAM_PREFIX)) return { meta: null };

  const channelId = id.replace(STREAM_PREFIX, "");
  const m3uUrl = (config && config.m3u_url) || manifest.config[0].default;
  const cacheKey = `meta_${channelId}_${m3uUrl}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channel = await getChannel(channelId, m3uUrl);
    const response = {
      meta: {
        id,
        type: "tv",
        name: `${channel.group_title} · ${channel.name}`,
        poster: channel.logo_url,
        background: channel.logo_url,
        description: `Grupo: ${channel.group_title}`
      }
    };
    cache.set(cacheKey, response);
    return response;
  } catch (err) {
    console.error("Meta error:", err);
    return { meta: null };
  }
});

// ------- Streams -------
builder.defineStreamHandler(async ({ type, id, config }) => {
  if (type !== "tv" || !id.startsWith(STREAM_PREFIX)) return { streams: [] };

  const channelId = id.replace(STREAM_PREFIX, "");
  const m3uUrl = (config && config.m3u_url) || manifest.config[0].default;
  const cacheKey = `streams_${channelId}_${m3uUrl}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channel = await getChannel(channelId, m3uUrl);
    const streams = [];

    // Importante: en db.js, additional_streams ya incluye el primero
    (channel.additional_streams || []).forEach((s, idx) => {
      // ACESTREAM
      if (s.acestream_id) {
        streams.push({
          name: s.group_title || channel.group_title,
          title: s.title || `${channel.group_title} · ${channel.name} • ACESTREAM`,
          externalUrl: `acestream://${s.acestream_id}`,
          behaviorHints: { notWebReady: true, external: true }
        });
      }
      // M3U8 (web-ready)
      if (s.url) {
        streams.push({
          name: s.group_title || channel.group_title,
          title: s.title || `${channel.group_title} · ${channel.name} • M3U8`,
          url: s.url,
          behaviorHints: { notWebReady: false }
        });
      }
      // Browser (enlace normal)
      if (!s.acestream_id && !s.url && s.stream_url) {
        streams.push({
          name: s.group_title || channel.group_title,
          title: s.title || `${channel.group_title} · ${channel.name} • BROWSER`,
          externalUrl: s.stream_url,
          behaviorHints: { notWebReady: true, external: true }
        });
      }
    });

    if (channel.website_url) {
      streams.push({
        title: `${channel.name} • WEBSITE`,
        externalUrl: channel.website_url,
        behaviorHints: { notWebReady: true, external: true }
      });
    }

    const response = { streams };
    cache.set(cacheKey, response);
    return response;
  } catch (err) {
    console.error("Stream error:", err);
    return { streams: [] };
  }
});

// ------- Dev HTTP -------
if (process.env.NODE_ENV !== "production") {
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

// ------- Serverless export -------
module.exports = (req, res) => {
  const addonInterface = builder.getInterface();
  const router = require("stremio-addon-sdk").getRouter(addonInterface);
  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
