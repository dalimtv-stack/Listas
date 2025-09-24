// src/eventos/stream-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJson } = require('../../api/kv');

// Detecta calidad y devuelve descripción
function detectarCalidad(label = '') {
  const calidad = label.toLowerCase();
  if (/(4320p|4320)/.test(calidad)) return 'Full UHD (4320p)';
  if (/(2160p|2160|uhd|4k)/.test(calidad)) return 'Ultra HD - 4K(2160p)';
  if (/(1440p|1440|2k|qhd|quad hd)/.test(calidad)) return 'Quad HD - 2K(1440p)';
  if (/(1080p|1080|fhd)/.test(calidad)) return 'Full HD (1080p)';
  if (/(720p|720|hd)/.test(calidad)) return 'HD (720p)';
  if (/(540p|540|480p|480|sd)/.test(calidad)) return '(SD)';
  return '';
}

// Limpia y transforma texto
function transformarTexto(texto = '') {
  return texto
    .replace(/\bVS\b|\bvs\b|\bVs\b/g, ' 🆚 ')
    .replace(/\bFútbol\b|\bFutbol\b|\(Fútbol\)|\(Futbol\)/gi, '⚽')
    .replace(/\bBaloncesto\b|\(Baloncesto\)/gi, '🏀');
}

// Detecta tipo de stream
function detectarFormato(label = '') {
  const lower = label.toLowerCase();
  if (lower.includes('acestream')) return '🔄 Acestream';
  if (lower.includes('m3u8')) return '🔗 MU38';
  if (lower.includes('directo')) return '🔗 Directo';
  if (lower.includes('vlc')) return '🔗 VLC';
  return '🔗 Stream';
}

async function getStreams(id, configId) {
  const configData = await kvGetJson(configId);
  const url = configData?.eventosUrl;
  const eventos = url ? await fetchEventos(url) : [];

  const prefix = `Heimdallr_evt_${configId}_`;
  const cleanId = id.startsWith(prefix) ? id.slice(prefix.length) : id;

  const evento = eventos.find(ev => normalizeId(ev) === cleanId);
  if (!evento) return { streams: [], chName: '' };

  const partido = transformarTexto(evento.partido);
  const deporte = transformarTexto(evento.deporte);

  const seen = new Set();
  const streams = [];
  for (const canal of evento.canales) {
    const rawLabel = canal.label || deporte;
    const url = canal.url;
    if (!url || seen.has(url)) continue;

    const canalName = rawLabel.split('-->').shift().trim();
    const temporal = rawLabel.split('-->').pop().trim();

    const calidad = detectarCalidad(rawLabel);
    const formato = detectarFormato(rawLabel);

    streams.push({
      name: canalName,
      title: `${partido}  ${deporte}\nFormato:  ${formato}  \nCalidad:  🖥️ ${calidad}  \nCanal:  📡 ${canalName} \nProveedor:  🏴‍☠️${temporal}🏴‍☠️`,
      externalUrl: url,
      behaviorHints: { notWebReady: true, external: true }
    });
    seen.add(url);
  }

  return { streams, chName: partido };
}

module.exports = { getStreams };
