const { addonBuilder, getRouter, serveHTTP } = require("stremio-addon-sdk");
const NodeCache = require("node-cache");
const { getChannels, getChannel } = require("./src/db");
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require("./src/config");
require("dotenv").config();

const cache = new NodeCache({ stdTTL: CACHE_TTL });

const manifest = {
  id: "org.stremio.Heimdallr",
  version: "1.3.41",
  name: "Heimdallr Channels",
  description: "Addon para cargar canales Acestream o M3U8 desde una lista M3U configurable por el usuario.",
  types: ["tv"],
  logo: "https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960",
  catalogs: [
    {
      type: "tv",
      id: "Heimdallr",
      name: "Heimdallr Live Channels",
      extra: [{ name: "search", isRequired: false }]
    }
  ],
  resources: ["catalog", "meta", "stream"],
  idPrefixes: [STREAM_PREFIX],
  config: [
    {
      key: "m3u_url",
      type: "text",
      title: "M3U URL",
      description: "Introduce la URL de la lista M3U (deja vacío para usar la predeterminada)",
      default: "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u"
    }
  ]
};

const builder = new addonBuilder(manifest);

// ------------------- Catalog -------------------
builder.defineCatalogHandler(async ({ type, id, config }) => {
  if (type === "tv" && id === "Heimdallr") {
    const m3uUrl = config?.m3u_url || manifest.config[0].default;
    const cacheKey = `catalog_${m3uUrl}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const channels = await getChannels(m3uUrl);
      const metas = channels.map(c => ({
        id: `${STREAM_PREFIX}${c.id}`,
        type: "tv",
        name: `${c.group_title} - ${c.name}`,
        poster: c.logo_url
      }));

      const response = { metas };
      cache.set(cacheKey, response);
      return response;
    } catch (err) {
      console.error("Catalog error:", err);
      return { metas: [] };
    }
  }
  return { metas: [] };
});

// ------------------- Meta -------------------
builder.defineMetaHandler(async ({ type, id, config }) => {
  if (type === "tv" && id.startsWith(STREAM_PREFIX)) {
    const channelId = id.replace(STREAM_PREFIX, "");
    const m3uUrl = config?.m3u_url || manifest.config[0].default;
    const cacheKey = `meta_${channelId}_${m3uUrl}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const c = await getChannel(channelId, m3uUrl);
      const response = {
        meta: {
          id,
          type: "tv",
          name: `${c.group_title} - ${c.name}`,
          poster: c.logo_url,
          background: c.logo_url,
          description: `Canal del grupo: ${c.group_title}`
        }
      };
      cache.set(cacheKey, response);
      return response;
    } catch (err) {
      console.error("Meta error:", err);
      return { meta: null };
    }
  }
  return { meta: null };
});

// ------------------- Stream -------------------
builder.defineStreamHandler(async ({ type, id, config }) => {
  if (type === "tv" && id.startsWith(STREAM_PREFIX)) {
    const channelId = id.replace(STREAM_PREFIX, "");
    const m3uUrl = config?.m3u_url || manifest.config[0].default;
    const cacheKey = `stream_${channelId}_${m3uUrl}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const c = await getChannel(channelId, m3uUrl);
      const streams = [];

      c.additional_streams.forEach((s, idx) => {
        streams.push({
          name: s.group_title || c.group_title,
          title: s.title || `${c.name} (Stream ${idx + 1})`,
          url: s.url,
          externalUrl: s.acestream_id ? `acestream://${s.acestream_id}` : s.stream_url,
          behaviorHints: {
            notWebReady: s.acestream_id || s.stream_url ? true : false,
            external: s.acestream_id || s.stream_url ? true : false
          }
        });
      });

      if (c.website_url) {
        streams.push({
          title: `${c.name} - Website`,
          externalUrl: c.website_url,
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
  }
  return { streams: [] };
});

// ------------------- Servir en desarrollo -------------------
if (process.env.NODE_ENV !== "production") {
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

module.exports = (req, res) => {
  const addonInterface = builder.getInterface();
  const router = getRouter(addonInterface);
  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
