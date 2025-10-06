// src/eventos/stream-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJsonTTL } = require('../../api/kv');
const { channelAliases, normalizeName } = require('../../api/scraper');

function getChannelIdFromLabel(label) {
  if (!label) return null;
  const { canalLimpio } = extraerYLimpiarCalidad(label);
  return canalLimpio || null;
}

function extraerYLimpiarCalidad(label = '') {
  const qualityMap = {
    '4320': 'Full UHD',
    '2160': 'Ultra HD',
    '1440': 'Quad HD',
    '1080': 'Full HD',
    '720': 'HD',
    'sd': 'SD'
  };
  const qualityRegex = /(4320p?|2160p?|1440p?|1080p?|720p?|sd)/i;
  const match = label.match(qualityRegex);
  const calidadDetectada = match
    ? qualityMap[match[1].toLowerCase().replace('p', '')] || 'SD'
    : 'SD';
  const canalLimpio = label.replace(qualityRegex, '').replace(/\s+/g, ' ').trim();
  return { canalLimpio, calidadDetectada };
}

function transformarTexto(texto = '') {
  const emojis = {
    'futbol': '⚽',
    'fútbol': '⚽',
    'basket': '🏀',
    'baloncesto': '🏀',
    'tenis': '🎾',
    'f1': '🏎️',
    'formula 1': '🏎️',
    'deporte': '🏅',
    'deportes': '🏅',
    'cine': '🎬',
    'movistar': '📺',
    'dazn': '📺',
    'espn': '📺'
  };
  let result = String(texto);
  for (const [key, emoji] of Object.entries(emojis)) {
    result = result.replace(new RegExp(key, 'gi'), `${emoji} ${key}`);
  }
  return result.trim();
}

function detectarFormatoDesdeUrl(url = '') {
  if (url.includes('acestream://')) return 'Acestream';
  if (url.includes('.m3u8')) return 'M3U8';
  if (url.includes('vlc.shickat.me')) return 'VLC';
  return 'Browser';
}

async function getStreams(id, configId) {
  try {
    const prefix = `Heimdallr_evt_${configId}_`;
    const cleanId = id?.startsWith(prefix) ? id.slice(prefix.length) : id;

    const hoyKV = await kvGetJsonTTL('EventosHoy');
    const mañanaKV = await kvGetJsonTTL('EventosMañana');

    const hoyData = (hoyKV && typeof hoyKV.data === 'object') ? hoyKV.data : {};
    const mañanaData = (mañanaKV && typeof mañanaKV.data === 'object') ? mañanaKV.data : {};

    const allEventos = { ...hoyData, ...mañanaData };

    const evento = Object.values(allEventos).find(ev => normalizeId(ev) === cleanId);
    if (!evento) {
      console.info('[STREAM] No se encontró evento con id normalizado:', cleanId);
      return { streams: [], chName: '' };
    }

    if (!Array.isArray(evento.canales) || !evento.canales[0]?.label) {
      console.info('[STREAM] Evento sin canales válidos:', evento.partido);
      return { streams: [], chName: '' };
    }

    const label = evento.canales[0].label;
    const normalized = normalizeName(label);
    const channelId = getChannelIdFromLabel(label);

    console.info('[STREAM] Canal detectado en evento:', {
      rawLabel: label,
      normalized,
      resolvedChannelId: channelId
    });

    if (!channelId) {
      console.info('[STREAM] No se pudo resolver channelId para label:', label);
      return { streams: [], chName: '' };
    }

    const kvKey = `Streams:${channelId}:${configId}`;
    console.info('[STREAM] Buscando streams en KV con clave:', kvKey);

    const cached = await kvGetJsonTTL(kvKey);
    const rawStreams = (cached?.streams) || (cached?.data?.streams) || [];

    if (!Array.isArray(rawStreams) || rawStreams.length === 0) {
      console.info('[STREAM] No se encontraron streams en KV para', kvKey);
      return { streams: [], chName: '' };
    }

    const partido = transformarTexto(evento.partido);
    const deporte = transformarTexto(evento.deporte);
    const seen = new Set();

    const streams = rawStreams.map(stream => {
      const dedupKey = stream.externalUrl || stream.url;
      if (!dedupKey || seen.has(dedupKey)) return null;
      seen.add(dedupKey);

      const { canalLimpio, calidadDetectada } = extraerYLimpiarCalidad(stream.name || '');
      const canalName = canalLimpio.split('-->').shift().trim();
      const temporal = stream.group_title || 'NEW ERA';
      const formato = detectarFormatoDesdeUrl(stream.externalUrl || stream.url || '');

      return {
        name: canalName || 'Canal',
        title: `${partido} ${deporte}\nFormato: ${formato}\nCalidad: 🖥️ ${calidadDetectada}\nCanal: 📡 ${canalName}\nProveedor: 🏴‍☠️${temporal}🏴‍☠️`,
        externalUrl: stream.externalUrl,
        url: stream.url,
        behaviorHints: stream.behaviorHints
      };
    }).filter(Boolean);

    console.info('[STREAM] streams de evento generados:', streams.length);
    return { streams, chName: partido };
  } catch (e) {
    console.error('[STREAM] getStreams error:', e);
    return { streams: [], chName: '' };
  }
}

module.exports = { getStreams, extraerYLimpiarCalidad, transformarTexto, detectarFormatoDesdeUrl };
