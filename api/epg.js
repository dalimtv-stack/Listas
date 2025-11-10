// api/epg.js
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
    const canalId = p.channel?.
