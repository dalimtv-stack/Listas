// api/handlers/manifest.js
'use strict';

const { kvGetJson, kvGetJsonTTL } = require('../kv');
const {
  BASE_ADDON_ID,
  ADDON_NAME,
  ADDON_PREFIX,
  CATALOG_PREFIX,
  VERSION,
  FORCE_REFRESH_GENRES
} = require('../../src/config');

async function getLastUpdateString(configId) {
  try {
    const raw = await kvGetJson(`last_update:${configId}`);
    if (raw && typeof raw === 'string' && raw.trim()) return raw.trim();
  } catch {}
  return 'Sin actualizar aún';
}

async function buildManifest(configId) {
  let genreOptions = ['General'];
  const lastUpdateStr = await getLastUpdateString(configId);
  let currentM3u = '';
  let currentExtraWebs = '';
  let currentEventosUrl = '';

  try {
    const cfg = await kvGetJson(configId);
    if (cfg) {
      currentM3u = cfg.m3uUrl || '';
      currentExtraWebs = cfg.extraWebs || '';
      currentEventosUrl = cfg.eventosUrl || '';
    }
  } catch {}

  try {
    const genresKV = await kvGetJsonTTL(`genres:${configId}`);
    if (Array.isArray(genresKV) && genresKV.length > 1) {
      genreOptions = genresKV;
      console.log(`[MANIFEST] géneros cargados desde KV para ${configId}: ${genreOptions.length}`);
    } else if (FORCE_REFRESH_GENRES) {
      console.warn(`[MANIFEST] FORCE_REFRESH_GENRES activo pero géneros no disponibles, usando ['General']`);
    } else {
      console.warn(`[MANIFEST] No se encontraron géneros válidos en KV para ${configId}, usando ['General']`);
    }
  } catch (e) {
    console.error(`[MANIFEST] error al cargar géneros para ${configId}:`, e.message);
  }

  return {
    id: BASE_ADDON_ID,
    version: VERSION,
    name: ADDON_NAME,
    description: `Carga canales Acestream o M3U8 desde lista M3U.\nÚltima actualización: ${lastUpdateStr}`,
    types: ['tv'],
    logo: 'https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960',
    resources: ['catalog', 'meta', 'stream'],
    // 👇 Aquí está la corrección: prefijos globales para canales y eventos
    idPrefixes: [
      `${ADDON_PREFIX}_${configId}_',
      `Heimdallr_evt_${configId}_`
    ],
    behaviorHints: { configurable: true },
    config: [
      { name: 'm3uUrl', label: 'URL de la lista M3U', type: 'text', required: true, value: currentM3u },
      { name: 'extraWebs', label: 'Webs adicionales', type: 'text', required: false, value: currentExtraWebs },
      { name: 'eventosUrl', label: 'URL de eventos', type: 'text', required: false, value: currentEventosUrl }
    ],
    catalogs: [
      {
        type: 'tv',
        id: `${CATALOG_PREFIX}_${configId}`,
        name: 'Heimdallr Live Channels',
        description: `Última actualización: ${lastUpdateStr}`,
        extra: [
          { name: 'search', isRequired: false },
          { name: 'genre', isRequired: false, options: genreOptions }
        ]
      },
      {
        type: 'tv',
        id: `${CATALOG_PREFIX}_eventos_${configId}`,
        name: 'Heimdallr Eventos',
        description: 'Eventos deportivos en directo',
        extra: []
      }
    ]
  };
}

module.exports = { buildManifest, getLastUpdateString };
