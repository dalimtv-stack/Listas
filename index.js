const { addonBuilder, getRouter, serveHTTP } = require("stremio-addon-sdk");
const NodeCache = require("node-cache");
const { getChannels, getChannel } = require("./src/db");
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require("./src/config");
require("dotenv").config();

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Manifest estático
const manifest = {
  id: "org.stremio.Heimdallr",
  version: "1.3.005",
  name: "Heimdallr Channels",
  description: "Addon para cargar canales Acestream o M3U8 desde una lista M3U.",
  types: ["tv"],
  logo: "https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960",
  catalogs: [
    {
      type: "tv",
      id: "Heimdallr",
      name: "Heimdallr Live Channels",
      extra: [
        { name: "search" },
        { name: "genre", options: [], isRequired: false } // vacío, pero soporta filtro
      ]
    }
  ],
  resources: ["stream", "meta", "catalog"],
  idPrefixes: [STREAM_PREFIX]
};

const builder = new addonBuilder(manifest);

// Catalog handler
builder.defineCatalogHandler(async (args = {}) => {
  const { type, id, extra = {} } = args;
  if (type !== "tv" || id !== "Heimdallr") return { metas: [] };

  const useCache = !extra.genre && !extra.search;
  const cacheKey = "Heimdallr_catalog";
  if (useCache) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  try {
    const channels = await getChannels();

    let filtered = channels;

    if (extra.genre) {
      filtered = filtered.filter(
        c => (c.group_title || "").toLowerCase() === extra.genre.toLowerCase()
      );
    }

    if (extra.search) {
      const s = extra.search.toLowerCase();
      filtered = filtered.filter(c => (c.name || "").toLowerCase().includes(s));
    }

    const metas = filtered.map(channel => ({
      id: `${STREAM_PREFIX}${channel.id}`,
      type: "tv",
      name: channel.name,
      poster: channel.logo_url || null,
      genre: channel.group_title ? [channel.group_title] : undefined
    }));

    const response = { metas };
    if (useCache) cache.set(cacheKey, response);
    return response;
  } catch (err) {
    console.error("Catalog error:", err);
    return { metas: [] };
  }
});

// Meta handler
builder.defineMetaHandler(async ({ type, id } = {}) => {
  if (type !== "tv" || !id?.startsWith(STREAM_PREFIX)) return { meta: null };

  const channelId = id.replace(STREAM_PREFIX, "");
  const cacheKey = `meta_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channel = await getChannel(channelId);
    const response = {
      meta: {
        id,
        type: "tv",
        name: channel.name,
        poster: channel.logo_url || null,
        background: channel.logo_url || null,
        description: channel.name || "",
        genre: channel.group_title ? [channel.group_title] : undefined
      }
    };
    cache.set(cacheKey, response);
    return response;
  } catch (err) {
    console.error("Meta error:", err);
    return { meta: null };
  }
});

// Stream handler
builder.defineStreamHandler(async ({ type, id } = {}) => {
  if (type !== "tv" || !id?.startsWith(STREAM_PREFIX)) return { streams: [] };

  const channelId = id.replace(STREAM_PREFIX, "");
  const cacheKey = `stream_${channelId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const channel = await getChannel(channelId);
    const streams = [];

    const list = Array.isArray(channel.additional_streams) ? channel.additional_streams : [];

    for (const s of list) {
      const httpUrl = s.url || s.stream_url || null;
      if (s.acestream_id) {
        // Solo acestream -> externo
        streams.push({
          name: s.group_title || channel.group_title || "Acestream",
          title: s.title || channel.title || channel.name,
          externalUrl: `acestream://${s.acestream_id}`,
          behaviorHints: { notWebReady: true, external: true }
        });
      } else if (httpUrl) {
        // Todo lo demás -> interno
        streams.push({
          name: s.group_title || channel.group_title || "Stream",
          title: s.title || channel.title || channel.name,
          url: httpUrl
        });
      }
    }

    // fallback
    if (!streams.length && channel.stream_url) {
      streams.push({
        name: channel.group_title || "Stream",
        title: channel.title || channel.name,
        url: channel.stream_url
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

// Local dev
if (process.env.NODE_ENV !== "production") {
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

// Vercel handler
module.exports = (req, res) => {
  const addonInterface = builder.getInterface();
  const router = getRouter(addonInterface);
  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
