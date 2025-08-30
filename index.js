const { addonBuilder } = require("stremio-addon-sdk");
const fs = require("fs");
const path = require("path");

const manifest = {
  id: "org.stremio.acestream",
  version: "1.0.0",
  name: "AceStream M3U Addon",
  description: "Addon para reproducir enlaces AceStream desde una lista M3U",
  catalogs: [],
  resources: ["stream"],
  types: ["tv"],
  idPrefixes: ["acestream:"]
};

const builder = new addonBuilder(manifest);

// Cargar lista M3U
function loadPlaylist() {
  const m3uPath = path.join(__dirname, "shickat_list.m3u");
  const content = fs.readFileSync(m3uPath, "utf8");

  const regex = /#EXTINF:-1.*,(.*?)\n(acestream:\/\/[a-zA-Z0-9]+)/g;
  let match;
  const channels = {};

  while ((match = regex.exec(content)) !== null) {
    const name = match[1].trim();
    const url = match[2].trim();
    channels[name.toLowerCase()] = { name, url };
  }

  return channels;
}

const channels = loadPlaylist();

// Definir recurso "stream"
builder.defineStreamHandler(({ id }) => {
  const channel = channels[id.toLowerCase()];
  if (channel) {
    return Promise.resolve({
      streams: [
        {
          title: channel.name,
          externalUrl: channel.url,
          behaviorHints: { notWebReady: true }
        }
      ]
    });
  } else {
    return Promise.resolve({ streams: [] });
  }
});

// Exportar servidor Express para Vercel
const express = require("express");
const app = express();

app.get("/", (_, res) => {
  res.json(manifest);
});

app.get("/:resource/:type/:id.json", async (req, res) => {
  try {
    const resp = await builder.getInterface().get(req.params);
    res.json(resp);
  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

module.exports = app;
