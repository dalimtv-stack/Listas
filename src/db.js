// src/db.js
const fetch = require("node-fetch");

const M3U_URL = "https://tuservidor.com/tu-lista.m3u"; // pon aquí tu URL

async function fetchM3U() {
  const res = await fetch(M3U_URL);
  const text = await res.text();

  const lines = text.split("\n");
  let channels = [];
  let currentChannel = {};
  let currentGroup = "Otros"; // categoría por defecto

  for (let line of lines) {
    line = line.trim();

    if (!line) continue;

    // Detectar comentarios que indican categoría
    if (line.startsWith("#") && !line.startsWith("#EXTINF") && !line.startsWith("#EXTM3U")) {
      currentGroup = line.replace(/^#\s*/, "").trim(); // ej: "# Deportes" → "Deportes"
    }

    // Procesar canal
    if (line.startsWith("#EXTINF")) {
      const nameMatch = line.match(/,(.*)$/);
      const name = nameMatch ? nameMatch[1].trim() : "Canal Desconocido";

      const logoMatch = line.match(/tvg-logo="(.*?)"/);
      const logo = logoMatch ? logoMatch[1] : null;

      currentChannel = { name, logo, group: currentGroup };
    } else if (!line.startsWith("#")) {
      // URL del canal
      currentChannel.url = line.trim();
      channels.push(currentChannel);
      currentChannel = {};
    }
  }

  // Agrupar por categoría
  const grouped = {};
  for (let ch of channels) {
    if (!grouped[ch.group]) grouped[ch.group] = [];
    grouped[ch.group].push(ch);
  }

  return grouped;
}

async function getChannels() {
  return await fetchM3U();
}

module.exports = {
  getChannels,
};
