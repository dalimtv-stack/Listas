const axios = require("axios");

let cachedChannels = [];
let m3uUrl = process.env.M3U_URL || "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/shickat_list.m3u";

async function parseM3U(url) {
  try {
    const { data } = await axios.get(url);
    const lines = data.split("\n");
    const channels = [];
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].startsWith("#EXTINF")) {
        const nameMatch = lines[i].match(/,(.+)$/);
        const name = nameMatch ? nameMatch[1].trim() : "Canal Desconocido";
        const logoMatch = lines[i].match(/tvg-logo="([^"]+)"/);
        const logo = logoMatch ? logoMatch[1] : "https://upload.wikimedia.org/wikipedia/commons/3/35/Ace_Stream_logo.png";
        const aceUrl = lines[i + 1]?.trim();
        if (aceUrl && aceUrl.startsWith("acestream://")) {
          const id = name.toLowerCase().replace(/[^a-z0-9]/g, "-"); // ID simple basado en nombre (ej. "dazn-1-fhd")
          channels.push({ id, name, aceUrl, logo });
          i++; // Saltar la URL procesada
        }
      }
    }
    console.log(`Parsed ${channels.length} channels from M3U`);
    return channels;
  } catch (error) {
    console.error("Error parsing M3U:", error.message);
    return [];
  }
}

function updateM3UConfig(config) {
  if (config && config.m3uUrl) {
    m3uUrl = config.m3uUrl;
    cachedChannels = []; // Limpiar caché
    console.log(`M3U URL updated to: ${m3uUrl}`);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method === "POST" && req.body && req.body.config) {
    updateM3UConfig(req.body.config);
    res.status(200).json({ message: "Configuración actualizada" });
    return;
  }

  if (!cachedChannels.length) {
    cachedChannels = await parseM3U(m3uUrl);
  }

  try {
    const path = req.url.split("?")[0];
    if (path.startsWith("/catalog")) {
      const metas = cachedChannels.map(c => ({
        id: `channel:${c.id}`,
        type: "channel",
        name: c.name,
        poster: c.logo
      }));
      res.status(200).json({ metas });
    } else if (path.startsWith("/meta")) {
      const id = path.split("/").pop().replace("channel:", ""); // Extraer ID sin prefijo
      const ch = cachedChannels.find(c => c.id === id);
      if (ch) {
        res.status(200).json({
          meta: {
            id: `channel:${ch.id}`,
            type: "channel",
            name: ch.name,
            poster: ch.logo,
            description: "Canal Acestream desde lista Shickat."
          }
        });
      } else {
        res.status(200).json({ meta: {} });
      }
    } else if (path.startsWith("/stream")) {
      const id = path.split("/").pop().replace("channel:", ""); // Extraer ID sin prefijo
      const ch = cachedChannels.find(c => c.id === id);
      if (ch) {
        res.status(200).json({
          streams: [{
            externalUrl: ch.aceUrl,
            title: ch.name,
            behaviorHints: { notWebReady: true, isExternal: true },
            protocol: "acestream"
          }]
        });
      } else {
        res.status(200).json({ streams: [] });
      }
    } else {
      res.status(404).send("Not found");
    }
  } catch (error) {
    console.error("Error in handler:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
