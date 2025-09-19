// src/config.js
module.exports = {
  // Tiempo de vida del caché (en segundos)
  CACHE_TTL: 300, // 30 minutos

  // Puerto en el que se levantará el servidor
  DEFAULT_PORT: 3000,

  // Prefijo para los IDs de stream
  STREAM_PREFIX: 'heimdallr_',

  // Nombre del addon
  ADDON_NAME: "Heimdallr Channels",

  // ID del addon (tiene que ser único)
  ADDON_ID: "org.stremio.Heimdallr",

  // Constantes adicionales desde api/index.js
  BASE_ADDON_ID: 'org.stremio.Heimdallr',
  ADDON_PREFIX: 'heimdallr',
  CATALOG_PREFIX: 'Heimdallr',
  DEFAULT_CONFIG_ID: 'default',
  DEFAULT_M3U_URL: process.env.DEFAULT_M3U_URL || 'https://raw.githubusercontent.com/dalimtv-stack/Listas/refs/heads/main/Lista_total.m3u',
  VERSION: require('../package.json').version,
  // Constante para forzar refresco
  FORCE_REFRESH_GENRES: false

};
