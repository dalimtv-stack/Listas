const axios = require("axios");

const m3uUrl = process.env.M3U_URL || "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/shickat_list.m3u";

async function parseM3U(url) {
  try {
    const { data } = await axios.get(url);
    const lines = data.split("\n");
    const channels = [];
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].startsWith("#EXTINF")) {
        const name = lines[i].split(",")[1]?.trim() || "Canal Desconocido";
        const aceUrl = lines[i + 1]?.trim();
        if (aceUrl && aceUrl.startsWith("acestream://")) {
          const id = `acestream:${name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "")}`;
          channels.push({ id, name, aceUrl });
          i++; // Saltar la URL procesada
        }
      }
    }
    return channels;
  } catch (error) {
    console.error("Error parsing M3U:", error.message);
    return [];
  }
}

let cachedChannels = [];

module.exports = async (req, res) => {
  const path = req.url.split("?")[0];
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (!cachedChannels.length) {
    cachedChannels = await parseM3U(m3uUrl);
  }

  try {
    if (path.startsWith("/catalog")) {
      const metas = cachedChannels.map(c => ({
        id: c.id,
        type: "tv",
        name: c.name,
        poster: "https://upload.wikimedia.org/wikipedia/commons/3/35/Ace_Stream_logo.png"
      }));
      res.status(200).json({ metas });
    } else if (path.startsWith("/meta")) {
      const id = path.split("/").pop();
      const ch = cachedChannels.find(c => c.id === id);
      if (ch) {
        res.status(200).json({
          meta: {
            id: ch.id,
            type: "tv",
            name: ch.name,
            poster: "https://upload.wikimedia.org/wikipedia/commons/3/35/Ace_Stream_logo.png",
            links: [{ name: "AceStream", url: ch.aceUrl }]
          }
        });
      } else {
        res.status(200).json({ meta: {} });
      }
    } else if (path.startsWith("/stream")) {
      const id = path.split("/").pop();
      const ch = cachedChannels.find(c => c.id === id);
      if (ch) {
        res.status(200).json({
          streams: [{
            name: "AceStream",
            title: ch.name,
            externalUrl: ch.aceUrl,
            behaviorHints: { notWebReady: true, external: true }
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
