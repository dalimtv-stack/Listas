// src/config.js
module.exports = {
  // Tiempo de vida del caché (en segundos)
  CACHE_TTL: 1800, // 30 minutos

  // Puerto en el que se levantará el servidor
  DEFAULT_PORT: 3000,

  // Prefijo para los IDs de stream
  STREAM_PREFIX: 'heimdallr_',

  // URL de tu lista M3U (pon aquí la que estés usando)
  M3U_URL: "https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/mi-lista.m3u",

  // Nombre del addon
  ADDON_NAME: "Heimdallr Channels",

  // ID del addon (tiene que ser único)
  ADDON_ID: "org.stremio.Heimdallr"
};
