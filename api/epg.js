// api/epg.js
'use strict';

const xml2js = require('xml2js');
const fetch = require('node-fetch');
const { kvGetJsonTTL, kvSetJsonTTLIfChanged } = require('./kv');

const EPG_URL = 'https://raw.githubusercontent.com/dalimtv-stack/miEPG/main/miEPG.xml';
const TTL = 24 * 3600; // 24 horas

function parseFechaXMLTV(str) {
  return new Date(str); // respeta el +0000 como UTC
}

function extraerEventosPorCanal(programas) {
  const eventosPorCanal = {};

  for (const p of programas) {
    const canalId = p.channel?.[0];
    if (!canalId) continue;

    const evento = {
      start: p.start?.[0],
      stop: p.stop?.[0],
      title: p.title?.[0]?._ || '',
      desc: p.desc?.[0]?._ || '',
      category: p.category?.[0] || '',
      icon: p.icon?.[0]?.src || '',
      rating: p.rating?.[0]?.value?.[0] || '',
      starRating: p['star-rating']?.[0]?.value?.[0] || ''
    };

    if (!eventosPorCanal[canalId]) eventosPorCanal[canalId] = [];
    eventosPorCanal[canalId].push(evento);
  }

  // Ordenar cada lista por fecha
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
  if (actual) return; // TTL válido

  const todos = await parsearXMLTV();
  const eventos = todos[canalId] || 'Sin información';
  await kvSetJsonTTLIfChanged(clave, eventos, TTL);
}

async function getEventoActualDesdeKV(canalId) {
  const clave = `epg:${canalId}`;
  const eventos = await kvGetJsonTTL(clave);
  if (!Array.isArray(eventos)) return null;

  const ahora = new Date();
  let actual = null;

  for (const e of eventos) {
    const inicio = parseFechaXMLTV(e.start);
    const fin = e.stop ? parseFechaXMLTV(e.stop) : null;

    if (fin && inicio <= ahora && ahora < fin) {
      actual = e;
      break;
    }
  }

  if (!actual) {
    // Buscar el último anterior si no hay evento en curso
    for (let i = eventos.length - 1; i >= 0; i--) {
      const e = eventos[i];
      const inicio = parseFechaXMLTV(e.start);
      if (inicio < ahora) {
        actual = e;
        break;
      }
    }
  }

  return actual;
}

module.exports = {
  parsearXMLTV,
  actualizarEPGSiCaducado,
  getEventoActualDesdeKV
};
