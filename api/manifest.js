module.exports = (req, res) => {
  const manifest = {
    id: "org.stremio.shickatacestream",
    version: "0.0.8",
    name: "Shickat Acestream Channels",
    description: "Addon para cargar canales Acestream desde una lista M3U específica.",
    logo: "https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960",
    resources: ["catalog", "meta", "stream"],
    types: ["channel"],
    catalogs: [
      {
        type: "channel",
        id: "shickat-channels",
        name: "Shickat Live Channels",
        extra: [{ name: "search", isRequired: false }, { name: "category", value: "Live TV" }]
      }
    ],
    idPrefixes: ["channel:shickat:"],
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
