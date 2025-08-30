module.exports = (req, res) => {
  const manifest = {
    id: "org.listas-sand.acestream",
    version: "1.0.0",
    name: "AceStream M3U Addon",
    description: "Addon de Stremio que reproduce enlaces AceStream desde una lista M3U configurable",
    logo: "https://upload.wikimedia.org/wikipedia/commons/3/35/Ace_Stream_logo.png",
    resources: ["stream", "catalog", "meta"],
    types: ["tv"],
    catalogs: [
      { type: "tv", id: "ace-m3u", name: "Ace M3U" }
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

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  res.status(200).send(JSON.stringify(manifest));
};
