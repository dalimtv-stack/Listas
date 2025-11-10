// api/epg.js
'use strict';

const { XMLParser } = require('fast-xml-parser');
const fetch = require('node-fetch');
const { kvGetJsonTTL, kvSetJsonTTLIfChanged } = require('./kv');

const EPG_URL = 'https://raw.githubusercontent.com/dalimtv-stack/miEPG/main/miEPG.xml';
const TTL = 24 * 3600; // 24 horas

function parseFechaXMLTV(str) {
  const [fecha, offset] = str.split(' ');
  const año = fecha.slice(0, 4);
  const mes = fecha.slice(4, 6);
  const dia = fecha.slice(6, 8);
  const hora = fecha.slice(8, 10);
  const min = fecha.slice(10, 12);
  const seg = fecha.slice(12, 14);

  const iso = `${año}-${mes}-${dia}T${hora}:${min}:${seg}${offset || '+00:00'}`;
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
    return {};
  }

  const programas = parsed.tv?.programme;
  if (!Array.isArray(programas)) {
    console.warn('[EPG] XMLTV sin <programme>:', Object.keys(parsed.tv || {}));
    return {};
  }

  return extraerEventosPorCanal(programas);
}

async function actualizarEPGSiCaducado(canalId) {
  const clave = `epg:${canalId}`;
  const actual = await kvGetJsonTTL(clave);
  if (actual) return;

  const todos = await parsearXMLTV();
  let eventos = todos[canalId];

  if (!Array.isArray(eventos) || eventos.length === 0) {
    eventos = [{
      title: 'Sin información',
      desc: '',
      start: '',
      stop: ''
    }];
  }

  console.log('[EPG] eventos encontrados para', canalId, ':', Array.isArray(eventos) ? eventos.length : eventos);
  await kvSetJsonTTLIfChanged(clave, eventos, TTL);
}

async function getEventoActualDesdeKV(canalId) {
  const clave = `epg:${canalId}`;
  const eventos = await kvGetJsonTTL(clave);

  if (!Array.isArray(eventos) || eventos.length === 0) {
    return {
      actual: {
        title: 'Sin información',
        desc: '',
        start: '',
        stop: ''
      },
      siguientes: []
    };
  }

  const ahora = Date.now();

  let actual = null;
  let siguientes = [];

  for (const e of eventos) {
    const inicioTS = parseFechaXMLTV(e.start).getTime();
    const finTS = parseFechaXMLTV(e.stop).getTime();
    const desc = extraerTexto(e.desc);

    if (finTS && inicioTS <= ahora && ahora < finTS && desc && desc.length > 10) {
      actual = {
        ...e,
        title: extraerTexto(e.title),
        desc,
        category: extraerTexto(e.category)
      };
      break;
    }
  }

  if (!actual) {
    for (let i = eventos.length - 1; i >= 0; i--) {
      const e = eventos[i];
      const inicioTS = parseFechaXMLTV(e.start).getTime();
      const desc = extraerTexto(e.desc);
      if (inicioTS < ahora && desc && desc.length > 10) {
        actual = {
          ...e,
          title: extraerTexto(e.title),
          desc,
          category: extraerTexto(e.category)
        };
        break;
      }
    }
  }

  if (!actual) {
    actual = {
      title: 'Sin información',
      desc: '',
      start: '',
      stop: ''
    };
  }

  if (actual?.stop) {
    const finActualTS = parseFechaXMLTV(actual.stop).getTime();
    const vistos = new Set();
    siguientes = eventos
      .map(e => ({
        ...e,
        title: extraerTexto(e.title),
        desc: extraerTexto(e.desc),
        category: extraerTexto(e.category)
      }))
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

  return { actual, siguientes };
}

module.exports = {
  parsearXMLTV,
  parseFechaXMLTV,
  actualizarEPGSiCaducado,
  getEventoActualDesdeKV
};
