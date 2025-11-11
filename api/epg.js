// api/epg.js
'use strict';
const { XMLParser } = require('fast-xml-parser');
const fetch = require('node-fetch');
const { kvGetJsonTTL, kvSetJsonTTLIfChanged } = require('./kv');
const EPG_URL = 'https://raw.githubusercontent.com/dalimtv-stack/miEPG/main/miEPG.xml';
const TTL = 24 * 3600; // 24 horas
function parseFechaXMLTV(str) {
  const parts = str.trim().split(' ');
  const fecha = parts[0];
  const año = parseInt(fecha.slice(0, 4), 10);
  const mes = parseInt(fecha.slice(4, 6), 10) - 1;
  const dia = parseInt(fecha.slice(6, 8), 10);
  const hora = parseInt(fecha.slice(8, 10), 10);
  const min = parseInt(fecha.slice(10, 12), 10);
  const seg = parseInt(fecha.slice(12, 14), 10);
  const offset = parts[1] || '+0000';
  const offsetH = offset.slice(0, 3);
  const offsetM = offset.slice(3, 5);
  const iso = `${año}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}T` +
              `${String(hora).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}` +
              `${offsetH}:${offsetM}`;
  return new Date(iso);
}
function extraerTexto(x) {
  if (typeof x === 'string') return x;
  if (x && typeof x['#text'] === 'string') return x['#text'];
  return '';
}
function extraerEventosPorCanal(programas) {
  const eventosPorCanal = {};
  for (const p of programas) {
    const canalId = p.channel?.trim();
    if (!canalId) continue;
    const evento = {
      start: p.start || '',
      stop: p.stop || '',
      title: extraerTexto(p.title),
      desc: extraerTexto(p.desc),
      category: extraerTexto(p.category),
      icon: p.icon?.src || '',
      rating: p.rating?.value || '',
      starRating: p['star-rating']?.value || ''
    };
    if (!eventosPorCanal[canalId]) eventosPorCanal[canalId] = [];
    eventosPorCanal[canalId].push(evento);
  }
  for (const canal in eventosPorCanal) {
    eventosPorCanal[canal].sort((a, b) => a.start.localeCompare(b.start));
  }
  return eventosPorCanal;
}
async function parsearXMLTV() {
  const res = await fetch(EPG_URL);
  const xml = await res.text();
  const xmlClean = xml.replace(/^\uFEFF/, '').trim();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    allowBooleanAttributes: true
  });
  let parsed;
  try {
    parsed = parser.parse(xmlClean);
  } catch (err) {
    console.error('[EPG] Error al parsear XMLTV:', err.message);
    return { eventosPorCanal: {}, logosPorCanal: {} };
  }
  const programasRaw = parsed.tv?.programme;
  const canalesRaw = parsed.tv?.channel;
  const programas = Array.isArray(programasRaw)
    ? programasRaw
    : (programasRaw ? [programasRaw] : []);
  const canales = Array.isArray(canalesRaw)
    ? canalesRaw
    : (canalesRaw ? [canalesRaw] : []);
  const eventosPorCanal = programas.length ? extraerEventosPorCanal(programas) : {};
  const logosPorCanal = {};
  if (canales.length) {
    for (const c of canales) {
      const canalId = (c.id || '').trim();
      if (!canalId) continue;
      let iconSrc = '';
      if (c.icon) {
        if (Array.isArray(c.icon)) {
          iconSrc = c.icon[0]?.src || '';
        } else {
          iconSrc = c.icon.src || '';
        }
      }
      logosPorCanal[canalId] = iconSrc;
    }
  }
  return { eventosPorCanal, logosPorCanal };
}
async function actualizarEPGSiCaducado(canalId) {
  const clave = `epg:${canalId}`;
  const actual = await kvGetJsonTTL(clave);
  if (actual) return;
  const { eventosPorCanal, logosPorCanal } = await parsearXMLTV();
  let eventos = eventosPorCanal[canalId];
  const logo = logosPorCanal[canalId] || '';
  if (!Array.isArray(eventos) || eventos.length === 0) {
    eventos = [{
      title: 'Sin información',
      desc: '',
      start: '',
      stop: ''
    }];
  }
  console.log('[EPG] eventos encontrados para', canalId, ':', Array.isArray(eventos) ? eventos.length : eventos);
  await kvSetJsonTTLIfChanged(clave, { logo, eventos }, TTL);
}
async function getEventoActualDesdeKV(canalId) {
  const clave = `epg:${canalId}`;
  const data = await kvGetJsonTTL(clave);
  const eventos = Array.isArray(data) ? data : data?.eventos || [];
  const logo = Array.isArray(data) ? '' : data?.logo || '';
  if (!Array.isArray(eventos) || eventos.length === 0) {
    return {
      actual: { title: 'Sin información', desc: '', start: '', stop: '' },
      siguientes: [],
      logo
    };
  }
  const ahora = Date.now();
  let actual = null;
  let siguientes = [];
  for (const e of eventos) {
    const inicioTS = parseFechaXMLTV(e.start).getTime();
    const finTS = parseFechaXMLTV(e.stop).getTime();
    const desc = extraerTexto(e.desc);
    if (finTS && inicioTS <= ahora && ahora < finTS) {
      actual = { ...e, title: extraerTexto(e.title), desc, category: extraerTexto(e.category) };
      break;
    }
  }
  if (!actual) {
    for (const e of eventos) {
      const inicioTS = parseFechaXMLTV(e.start).getTime();
      const desc = extraerTexto(e.desc);
      if (inicioTS >= ahora) {
        actual = { ...e, title: extraerTexto(e.title), desc, category: extraerTexto(e.category) };
        break;
      }
    }
  }
  if (!actual) {
    actual = { title: 'Sin información', desc: '', start: '', stop: '' };
  }
  if (actual?.stop) {
    const finActualTS = parseFechaXMLTV(actual.stop).getTime();
    const vistos = new Set();
    siguientes = eventos
      .map(e => ({ ...e, title: extraerTexto(e.title), desc: extraerTexto(e.desc), category: extraerTexto(e.category) }))
      .filter(e => {
        const inicioTS = parseFechaXMLTV(e.start).getTime();
        const clave = `${e.start}-${e.title}`;
        if (inicioTS >= finActualTS && !vistos.has(clave)) {
          vistos.add(clave);
          return true;
        }
        return false;
      })
      .slice(0, 2);
  }
  return { actual, siguientes, logo };
}
module.exports = {
  parsearXMLTV,
  parseFechaXMLTV,
  actualizarEPGSiCaducado,
  getEventoActualDesdeKV
};
