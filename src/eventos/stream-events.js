// src/eventos/stream-events.js
'use strict';

const { fetchEventos } = require('./scraper-events');
const { normalizeId } = require('./utils-events');
const { kvGetJson } = require('../../api/kv');
const { resolveM3uUrl } = require('../../api/resolve');
const { DateTime } = require('luxon');

// ✅ Evita dependencia circular: acceso dinámico
const getStreamModule = () => require('../../api/handlers/stream');

// Registra canales no encontrados en KV
async function registrarErrorCanal(configId, canalName) {
  const { kvGetJsonTTL, kvSetJsonTTL } = require('../../api/kv');
  const clave = `Error:canal:${configId}`;
  const nuevo = { canal: canalName };

  try {
    const prev = await kvGetJsonTTL(clave) || [];
    const yaExiste = prev.some(e => e.canal === canalName);

    if (!yaExiste) {
      await kvSetJsonTTL(clave, [...prev, nuevo], 7 * 86400);
      console.warn(`[STREAM] Canal no encontrado registrado en ${clave}:`, canalName);
    }
  } catch (err) {
    console.error(`[STREAM] Error al registrar en KV ${clave}:`, err.message);
  }
}

// Detecta calidad y devuelve descripción + canal limpio
function extraerYLimpiarCalidad(label = '') {
  const calidadRaw = label.toLowerCase();
  const map = [
    { match: ['4320p', '4320'], nombre: 'Full UHD (4320p)' },
    { match: ['2160p', '2160', 'uhd', '4k'], nombre: 'Ultra HD - 4K(2160p)' },
    { match: ['1440p', '1440', '2k', 'qhd', 'quad hd'], nombre: 'Quad HD - 2K(1440p)' },
    { match: ['1080p', '1080', 'fhd'], nombre: 'Full HD (1080p)' },
    { match: ['720p', '720', 'hd'], nombre: 'HD (720p)' },
    { match: ['540p', '540', '480p', '480', 'sd'], nombre: 'SD (480p/540p)' }
  ];

  let calidadDetectada = '';
  for (const { match, nombre } of map) {
    if (match.some(m => calidadRaw.includes(m))) {
      calidadDetectada = nombre;
      break;
    }
  }

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
    .replace(/\bBaloncesto\b|\(Baloncesto\)/gi, '🏀')
    .replace(/\bTenis\b|\(Tenis\)/gi, '🎾');
}

async function getStreams(id, configId) {
  console.log('[EVENTOS] Entrando en getStreams con id:', id, 'configId:', configId);
  const configData = await kvGetJson(configId);
  const url = configData?.eventosUrl;

  const prefix = `Heimdallr_evt_${configId}_`;
  const cleanId = id.startsWith(prefix) ? id.slice(prefix.length) : id;

  // Detectar si el evento es de mañana
  const esDeManana = cleanId.startsWith(
    DateTime.now().plus({ days: 1 }).setZone('Europe/Madrid').toFormat('ddMMyyyy')
  );

  const eventos = url ? await fetchEventos(url, esDeManana ? { modo: 'mañana' } : {}) : [];
  console.log('[EVENTOS] Eventos cargados:', eventos.length);
  eventos.forEach(ev => {
    console.log('[EVENTOS] normalizeId(ev)=', normalizeId(ev), 'partido=', ev.partido, 'canal=', ev.canal);
  });

  const evento = eventos.find(ev => normalizeId(ev) === cleanId);
  if (!evento) return { streams: [], chName: '' };

  const partido = transformarTexto(evento.partido);
  const deporte = transformarTexto(evento.deporte);

  const canalName = (evento.canal || '').trim();
  if (!canalName) {
    return { streams: [], chName: partido };
  }

  // 🎯 Mapeo explícito de nombres de canal
  const canalMap = {
    'Teledeporte': 'Teledeporte.es',
    'Esport 3': 'Esport3.cat',
    'TV3': 'TV3.cat',
    'Movistar Plus+': 'Movistar.Plus.es',
    'Movistar Plus+ 2': 'Movistar.Plus.2.es',
    'M+ Ellas V': 'Movistar.Ellas.Vamos.es',
    'Eurosport': 'Eurosport.es',
    'Eurosport 2': 'Eurosport.2.es',
    'DAZN 1': 'DAZN.1.es',
    'DAZN 2': 'DAZN.2.es',
    'DAZN 3': 'DAZN.3.es',
    'DAZN 4': 'DAZN.4.es',
    'DAZN LALIGA': 'DAZN.LALIGA.es', 
    'M+ Deportes': 'Movistar.Deportes.es',
    'M+ Deportes 2': 'Movistar.Deportes.2.es',
    'M+ Deportes 3': 'Movistar.Deportes.3.es',
    'M+ Deportes 4': 'Movistar.Deportes.4.es',
    'M+ Deportes 5': 'Movistar.Deportes.5.es',
    'M+ Liga de Campeones': 'Movistar.Liga.de.Campeones.es',
    'M+ Liga de Campeones 2': 'Movistar.Liga.de.Campeones.2.es',
    'M+ Liga de Campeones 3': 'Movistar.Liga.de.Campeones.3.es',
    'M+ Liga de Campeones 4': 'Movistar.Liga.de.Campeones.4.es',
    'M+ Liga de Campeones 5': 'Movistar.Liga.de.Campeones.5.es',
    'M+ Liga de Campeones 6': 'Movistar.Liga.de.Campeones.6.es',
    'M+ Liga de Campeones 7': 'Movistar.Liga.de.Campeones.7.es',
    'M+ Liga de Campeones 8': 'Movistar.Liga.de.Campeones.8.es',
    'M+ Liga de Campeones 9': 'Movistar.Liga.de.Campeones.9.es',
    'M+ Liga de Campeones 10': 'Movistar.Liga.de.Campeones.10.es',
    'M+ Liga de Campeones 11': 'Movistar.Liga.de.Campeones.11.es',
    'M+ Liga de Campeones 12': 'Movistar.Liga.de.Campeones.12.es',
    'M+ Liga de Campeones 13': 'Movistar.Liga.de.Campeones.13.es',
    'M+ Liga de Campeones 14': 'Movistar.Liga.de.Campeones.14.es',
    'M+ Liga de Campeones 15': 'Movistar.Liga.de.Campeones.15.es',
    'M+ Liga de Campeones 16': 'Movistar.Liga.de.Campeones.16.es',
    'M+ Liga de Campeones 17': 'Movistar.Liga.de.Campeones.17.es',
    'M+ Golf': 'Movistar.Golf.es',
    'M+ Golf 2': 'Movistar.Golf.2.es',
    'Movistar Primera Federación': 'Canal.1.1RFEF',
    'GOL': 'GOL.PLAY.es',
    'LALIGA TV HYPERMOTION': 'LaLiga.Hypermotion.es',
    'LALIGA TV HYPERMOTION 2': 'LaLiga.Hypermotion.2.es',
    'LALIGA TV HYPERMOTION 3': 'LaLiga.Hypermotion.3.es',
    'LA 1': 'LA1.es',
    'Aragón TV': 'Aragon.TV.es',
    'TVG 2': 'TVG.2.gal',
    'M+ LALIGA': 'Movistar.LaLiga.es',
    'M+ Vamos': 'Movistar.Vamos.es'
  };

  const mappedName = canalMap[canalName] || canalName;
  const channelId = mappedName.replace(/\s+/g, '.');

  console.log('[EVENTOS] Buscando streams para canal:', mappedName, 'configId:', configId);

  const m3uUrl = await resolveM3uUrl(configId);
  const fakeId = `heimdallr_${configId}_${channelId}`;

  const { handleStreamInternal, enrichWithExtra } = getStreamModule();

  let result;
  try {
    result = await handleStreamInternal({ id: fakeId, m3uUrl, configId });
  } catch (err) {
    console.warn('[STREAM] Error en handleStreamInternal:', err.message);
    await registrarErrorCanal(configId, canalName);
    return { streams: [], chName: partido };
  }
  
  if (!result || !result.streams || !Array.isArray(result.streams) || result.streams.length === 0) {
    await registrarErrorCanal(configId, canalName);
    return { streams: [], chName: partido };
  }
  
  result.id = fakeId;
  const enriched = await enrichWithExtra(result, configId, m3uUrl, false);

  const streams = enriched.streams;
  
  if (!streams.length) {
    const { kvGetJsonTTL, kvSetJsonTTL } = require('../../api/kv');
    const keyFaltantes = 'CanalesFaltantes';
    const canalFaltante = {
      id: channelId,
      nombre: canalName,
      partido,
      timestamp: new Date().toISOString()
    };
  
    const prev = await kvGetJsonTTL(keyFaltantes) || [];
    const yaExiste = prev.some(c => c.id === canalFaltante.id && c.nombre === canalFaltante.nombre);
  
    if (!yaExiste) {
      await kvSetJsonTTL(keyFaltantes, [...prev, canalFaltante], 7 * 86400); // TTL 7 días
      console.warn('[STREAM] Canal faltante registrado en KV:', canalFaltante);
    }
  }
    
  return { streams, chName: partido };
}

module.exports = { getStreams };
