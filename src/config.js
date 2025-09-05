// src/config.js
module.exports = {
  // Tiempo de vida del caché (en segundos)
  CACHE_TTL: 300, // 30 minutos

  // Tiempo de vida del caché de configuraciones (UUID -> m3uUrl)
  CONFIG_CACHE_TTL: 3600, // 1 hora

  // Puerto en el que se levantará el servidor
  DEFAULT_PORT: 3000,

  // Prefijo para los IDs de stream
  STREAM_PREFIX: 'heimdallr_',

  // Nombre del addon
  ADDON_NAME: "Heimdallr Channels",

  // ID del addon (tiene que ser único)
  ADDON_ID: "org.stremio.Heimdallr"
};
