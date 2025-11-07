'use strict';

const xml2js = require('xml2js');
const fetch = require('node-fetch');
const { kvGetJsonTTL, kvSetJsonTTLIfChanged } = require('./kv');

const EPG_URL = 'https://raw.githubusercontent.com/dalimtv-stack/miEPG/main/miEPG.xml';
const TTL = 24 * 3600; // 24 horas

function parseFechaXMLTV(str) {
  const clean = str.split(' ')[0]; // "20251107081500"
  const año = clean.slice(0, 4);
  const mes = clean.slice(4, 6);
  const dia = clean.slice(6, 8);
  const hora = clean.slice(8, 10);
  const min = clean.slice(10, 12);
  const seg = clean.slice(12, 14);
  return new Date(`${año}-${mes}-${dia}T${hora}:${min}:${seg}Z`);
}

function extraerEventosPorCanal(programas) {
  const eventosPorCanal = {};

  for (const p of programas) {
    const canalId = p.channel?.[0];
    if (!canalId) continue;

    const startStr = p.start?.[0];
    const stopStr = p.stop?.[0];
    const tsStart = parseFechaXMLTV(startStr).getTime();
    const tsStop = stopStr ? parseFechaXMLTV(stopStr).getTime() : null;

    const evento = {
      start: startStr,
      stop: stopStr,
      tsStart,
      tsStop,
      title: p.title?.[0]?._ || '',
      desc: p.desc?.[0]?._ || '',
      category: p.category?.[0]?._ || '',
      icon: Array.isArray(p.icon?.[0]?.src) ? p.icon[0].src[0] : p.icon?.[0]?.src || '',
      rating: p.rating?.[0]?.value?.[0] || '',
      starRating: p['star-rating']?.[0]?.value?.[0] || ''
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
  const parsed = await xml2js.parseStringPromise(xml, { mergeAttrs: true });
  return extraerEventosPorCanal(parsed.tv.programme);
}

async function actualizarEPGSiCaducado(canalId) {
  const clave = `epg:${canalId}`;
  const actual = await kvGetJsonTTL(clave);
  if (actual) return;

  const todos = await parsearXMLTV();
  const eventos = todos[canalId] || 'Sin información';
  await kvSetJsonTTLIfChanged(clave, eventos, TTL);
}

async function getEventoActualDesdeKV(canalId) {
  const clave = `epg:${canalId}`;
  const eventos = await kvGetJsonTTL(clave);
  if (!Array.isArray(eventos)) return null;

  const ahora = Date.now();
  let actual = null;
  let siguientes = [];

  for (const e of eventos) {
    if (e.tsStop && e.tsStart <= ahora && ahora < e.tsStop && e.desc) {
      actual = e;
      break;
    }
  }

  if (!actual) {
    for (let i = eventos.length - 1; i >= 0; i--) {
      const e = eventos[i];
      if (e.tsStart < ahora && e.desc) {
        actual = e;
        break;
      }
    }
  }

  if (actual?.tsStop) {
    const vistos = new Set();
    siguientes = eventos.filter(e => {
      const clave = `${e.start}-${e.title}`;
      return e.tsStart >= actual.tsStop && !vistos.has(clave) && vistos.add(clave);
    }).slice(0, 2);
  }

  return { actual, siguientes };
}

module.exports = {
  parsearXMLTV,
  parseFechaXMLTV,
  actualizarEPGSiCaducado,
  getEventoActualDesdeKV
};
