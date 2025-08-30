const axios = require("axios");

let cachedChannels = [];
let m3uUrl = process.env.M3U_URL || "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/shickat_list.m3u";

async function parseM3U(url) {
  try {
    const { data } = await axios.get(url);
    const sections = data.split('#EXTM3U');
    const channels = [];
    
    for (const section of sections) {
      if (!section.trim()) continue;
      
      const lines = section.split('\n');
      let currentChannel = {};
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (line.startsWith('#EXTINF')) {
          // Parse channel info
          const nameMatch = line.match(/,(.+)$/);
          currentChannel.name = nameMatch ? nameMatch[1].replace(/\(FHD\)/i, "").trim() : "Canal Desconocido";
          
          const logoMatch = line.match(/tvg-logo="([^"]+)"/);
          currentChannel.logo = logoMatch ? logoMatch[1] : "https://upload.wikimedia.org/wikipedia/commons/3/35/Ace_Stream_logo.png";
          
          const idMatch = line.match(/tvg-id="([^"]+)"/);
          currentChannel.tvgId = idMatch ? idMatch[1] : "";
        } 
        else if (line.startsWith('acestream://')) {
          // This is the stream URL
          currentChannel.aceUrl = line;
          
          // Generate a unique ID
          const idBase = currentChannel.tvgId || currentChannel.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
          currentChannel.id = `channel:${idBase}-${Math.random().toString(36).substr(2, 5)}`;
          
          channels.push(currentChannel);
          currentChannel = {}; // Reset for next channel
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
    cachedChannels = [];
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
    
    if (path === "/manifest.json") {
      // Serve manifest directly
      const manifest = {
        id: "org.stremio.shickatacestream",
        version: "0.1.1",
        name: "Shickat Acestream Channels",
        description: "Addon para cargar canales Acestream desde una lista M3U específica.",
        logo: "https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960",
        resources: ["catalog", "meta", "stream"],
        types: ["channel"],
        catalogs: [{ 
          type: "channel", 
          id: "shickat-channels", 
          name: "Shickat Live Channels", 
          extra: [
            { name: "search", isRequired: false }, 
            { name: "category", value: "Live TV" }
          ] 
        }],
        idPrefixes: ["channel:"],
        configurable: { 
          m3uUrl: { 
            type: "text", 
            title: "URL de la lista M3U", 
            default: "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/shickat_list.m3u" 
          } 
        }
      };
      
      res.status(200).json(manifest);
    } 
    else if (path === "/catalog/series/shickat-channels.json") {
      // Return all channels as catalog
      const metas = cachedChannels.map(c => ({
        id: c.id,
        type: "channel",
        name: c.name,
        poster: c.logo
      }));
      
      res.status(200).json({ metas });
    } 
    else if (path.startsWith("/meta/")) {
      // Handle meta requests
      const id = path.replace("/meta/", "").replace(".json", "");
      const channel = cachedChannels.find(c => c.id === id);
      
      if (channel) {
        res.status(200).json({ 
          meta: { 
            id: channel.id, 
            type: "channel", 
            name: channel.name, 
            poster: channel.logo, 
            description: "Canal Acestream" 
          } 
        });
      } else {
        res.status(200).json({ meta: {} });
      }
    } 
    else if (path.startsWith("/stream/")) {
      // Handle stream requests
      const id = path.replace("/stream/", "").replace(".json", "");
      const channel = cachedChannels.find(c => c.id === id);
      
      if (channel) {
        res.status(200).json({ 
          streams: [{
            externalUrl: channel.aceUrl, 
            title: channel.name, 
            behaviorHints: { 
              notWebReady: true, 
              isExternal: true 
            }, 
            protocol: "acestream" 
          }] 
        });
      } else {
        res.status(200).json({ streams: [] });
      }
    } 
    else {
      res.status(404).send("Not found");
    }
  } catch (error) {
    console.error("Error in handler:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
