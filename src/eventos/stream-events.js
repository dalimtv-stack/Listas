// src/eventos/stream-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJsonTTL } = require('../../api/kv');
const { channelAliases, normalizeName } = require('../../api/scraper');

function getChannelIdFromLabel(label) {
  if (!label) return null;
  const normalized = normalizeName(label);
  for (const [key, aliases] of Object.entries(channelAliases)) {
    if (key === normalized || aliases.includes(normalized)) {
      return key.replace(/\s/g, '_').toLowerCase();
    }
  }
  return null;
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
  const calidadDetectada = match ? qualityMap[match[1].toLowerCase().replace('p', '')] || 'SD' : 'SD';
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
  const prefix = `Heimdallr_evt_${configId}_`;
  const cleanId = id.startsWith(prefix) ? id.slice(prefix.length) : id;

  const eventosHoy = await kvGetJsonTTL('EventosHoy') || { data: {} };
  const eventosMañana = await kvGetJsonTTL('EventosMañana') || { data: {} };
  const allEventos = { ...eventosHoy.data, ...eventosMañana.data };
  const evento = Object.values(allEventos).find(ev => normalizeId(ev) === cleanId);

  if (!evento || !evento.canales || !evento.canales[0]?.label) {
    return { streams: [], chName: '' };
  }

  const label = evento.canales[0].label;
  const channelId = getChannelIdFromLabel(label);
  if (!channelId) {
    return { streams: [], chName: '' };
  }

  const kvKey = `Streams:${channelId}:${configId}`;
  const cached = await kvGetJsonTTL(kvKey);
  if (!cached || !cached.streams) {
    return { streams: [], chName: '' };
  }

  const partido = transformarTexto(evento.partido);
  const deporte = transformarTexto(evento.deporte);
  const seen = new Set();
  const streams = cached.streams.map(stream => {
    if (seen.has(stream.externalUrl || stream.url)) return null;
    seen.add(stream.externalUrl || stream.url);

    const { canalLimpio, calidadDetectada } = extraerYLimpiarCalidad(stream.name);
    const canalName = canalLimpio.split('-->').shift().trim();
    const temporal = stream.group_title || 'NEW ERA';
    const formato = detectarFormatoDesdeUrl(stream.externalUrl || stream.url);

    return {
      name: canalName,
      title: `${partido} ${deporte}\nFormato: ${formato}\nCalidad: 🖥️ ${calidadDetectada}\nCanal: 📡 ${canalName}\nProveedor: 🏴‍☠️${temporal}🏴‍☠️`,
      externalUrl: stream.externalUrl,
      url: stream.url,
      behaviorHints: stream.behaviorHints
    };
  }).filter(Boolean);

  return { streams, chName: partido };
}

module.exports = { getStreams, extraerYLimpiarCalidad, transformarTexto, detectarFormatoDesdeUrl };
