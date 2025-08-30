const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

// Manifesto dinámico
const manifest = {
  id: "org.listas-sand.acestream",
  version: "1.0.0",
  name: "AceStream M3U Addon",
  description: "Reproduce canales AceStream desde una lista M3U configurable",
  logo: "https://upload.wikimedia.org/wikipedia/commons/3/35/Ace_Stream_logo.png",
  resources: ["stream", "catalog", "meta"],
  types: ["tv"],
  catalogs: [
    {
      type: "tv",
      id: "ace-m3u",
      name: "Ace M3U"
    }
  ],
  idPrefixes: ["acestream"],
  configurable: {
    m3uUrl: {
      type: "text",
      title: "URL de la lista M3U",
      default: "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/shickat_list.m3u"
    }
  }
};

const builder = new addonBuilder(manifest);

// Guardamos la URL M3U configurada
let m3uUrl = manifest.configurable.m3uUrl.default;

// Cuando Stremio configura el addon
builder.defineConfigHandler((config) => {
  if (config.m3uUrl) {
    m3uUrl = config.m3uUrl;
    console.log("URL M3U configurada:", m3uUrl);
  }
  return {};
});

// Función para parsear la M3U y obtener canales
async function parseM3U(url) {
  const { data } = await axios.get(url);
  const lines = data.split("\n");
  const channels = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXTINF")) {
      const name = lines[i].split(",")[1]?.trim() || "Canal sin nombre";
      const aceUrl = lines[i + 1]?.trim();
      if (aceUrl && aceUrl.startsWith("acestream://")) {
        const id = "tv-" + name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "");
        channels.push({ id, name, aceUrl });
      }
    }
  }
  return channels;
}

// Stream handler
builder.defineStreamHandler(async ({ type, id }) => {
  try {
    if (!m3uUrl) throw new Error("No se ha configurado la URL M3U");
    const channels = await parseM3U(m3uUrl);
    const channel = channels.find(c => c.id === id);
    if (!channel) return { streams: [] };
    return { streams: [{ name: "AceStream", title: channel.name, externalUrl: channel.aceUrl, behaviorHints: { notWebReady: true, external: true } }] };
  } catch (e) {
    console.error(e);
    return { streams: [] };
  }
});

// Catalog handler (para listar canales en el catálogo)
builder.defineCatalogHandler(async ({ type, id }) => {
  if (type !== "tv") return { metas: [] };
  try {
    const channels = await parseM3U(m3uUrl);
    const metas = channels.map(c => ({
      id: c.id,
      type: "tv",
      name: c.name,
      poster: manifest.logo
    }));
    return { metas };
  } catch (e) {
    console.error(e);
    return { metas: [] };
  }
});

// Meta handler (información de cada canal)
builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== "tv") return { meta: {} };
  try {
    const channels = await parseM3U(m3uUrl);
    const channel = channels.find(c => c.id === id);
    if (!channel) return { meta: {} };
    return {
      meta: {
        id: channel.id,
        type: "tv",
        name: channel.name,
        poster: manifest.logo,
        links: [{ name: "AceStream", url: channel.aceUrl }]
      }
    };
  } catch (e) {
    console.error(e);
    return { meta: {} };
  }
});

// Exportamos la interfaz
module.exports = builder.getInterface();
