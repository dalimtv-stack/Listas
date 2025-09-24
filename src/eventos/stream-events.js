// src/eventos/stream-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJson } = require('../../api/kv');

// Detecta calidad y devuelve descripción + canal limpio
function extraerYLimpiarCalidad(label = '') {
  const calidadRaw = label.toLowerCase();
  const map = [
    { match: ['4320p', '4320'], nombre: 'Full UHD (4320p)' },
    { match: ['2160p', '2160', 'uhd', '4k'], nombre: 'Ultra HD - 4K(2160p)' },
    { match: ['1440p', '1440', '2k', 'qhd', 'quad hd'], nombre: 'Quad HD - 2K(1440p)' },
    { match: ['1080p', '1080', 'fhd'], nombre: 'Full HD (1080p)' },
    { match: ['720p', '720', 'hd'], nombre: 'HD (720p)' },
    { match: ['540p', '540', '480p', '480', 'sd'], nombre: '(SD)' }
  ];

  let calidadDetectada = '';
  for (const { match, nombre } of map) {
    if (match.some(m => calidadRaw.includes(m))) {
      calidadDetectada = nombre;
      break;
    }
  }

  // Elimina cualquier mención de calidad (con o sin paréntesis)
  const canalLimpio = label
    .replace(/\(?\b(?:SD|HD|FHD|QHD|2K|UHD|4K|480p|480|540p|540|720p|720|1080p|1080|1440p|1440|2160p|2160|4320p|4320)\b\)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { canalLimpio, calidadDetectada };
}

// Reemplaza términos en partido y deporte
function transformarTexto(texto = '') {
  return texto
    .replace(/\bVS\b|\bvs\b|\bVs\b/g, ' 🆚 ')
    .replace(/\bFútbol\b|\bFutbol\b|\(Fútbol\)|\(Futbol\)/gi, '⚽')
    .replace(/\bBaloncesto\b|\(Baloncesto\)/gi, '🏀');
}

// Detecta tipo de stream desde la URL
function detectarFormatoDesdeUrl(url = '') {
  const lower = url.toLowerCase();
  if (lower.startsWith('acestream://')) return '🔄 Acestream';
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

    const { canalLimpio, calidadDetectada } = extraerYLimpiarCalidad(rawLabel);
    const canalName = canalLimpio.split('-->').shift().trim();
    const temporal = canalLimpio.split('-->').pop().trim();
    const formato = detectarFormatoDesdeUrl(url);

    // Añadir paréntesis en name si no los tiene
    const nameFinal = /\(.*\)/.test(canalName) ? canalName : `${canalName}`;

    streams.push({
      name: nameFinal,
      title: `${partido}  ${deporte}\nFormato:  ${formato}  \nCalidad:  🖥️ ${calidadDetectada}  \nCanal:  📡 ${canalName} \nProveedor:  🏴‍☠️${temporal}🏴‍☠️`,
      externalUrl: url,
      behaviorHints: { notWebReady: true, external: true }
    });
    seen.add(url);
  }

  return { streams, chName: partido };
}

module.exports = { getStreams };
