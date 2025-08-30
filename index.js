const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

// Manifesto del addon
const manifest = {
  id: "org.dalimtv.acestream",
  version: "1.0.0",
  name: "AceStream M3U Addon",
  description: "Reproduce enlaces AceStream desde una lista M3U configurada",
  resources: ["stream"],
  types: ["tv"], // podemos ampliar luego
  catalogs: [],
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

// Guardamos la configuración
let m3uUrl = manifest.configurable.m3uUrl.default;

// Cuando el usuario instala/configura el addon
builder.defineConfigHandler((config) => {
  if (config.m3uUrl) {
    m3uUrl = config.m3uUrl;
    console.log("Nueva URL M3U configurada:", m3uUrl);
  }
  return {};
});

// Definimos cómo responder a peticiones de streams
builder.defineStreamHandler(async ({ type, id }) => {
  try {
    if (!m3uUrl) {
      throw new Error("No se ha configurado la URL M3U");
    }

    const { data } = await axios.get(m3uUrl);
    const lines = data.split("\n");
    let streams = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("#EXTINF")) {
        const name = lines[i].split(",")[1]?.trim() || "Canal sin nombre";
        const url = lines[i + 1]?.trim();

        if (url && url.startsWith("acestream://")) {
          streams.push({
            name: name,
            description: "Canal desde lista M3U",
            url: url
          });
        }
      }
    }

    return { streams };
  } catch (err) {
    console.error("Error al procesar la M3U:", err.message);
    return { streams: [] };
  }
});

// Exportar addon
module.exports = builder.getInterface();
