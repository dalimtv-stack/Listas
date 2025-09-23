'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { resolveM3uUrl } = require('../../api/resolve');

async function getStreams(id, configId) {
  const url = await resolveM3uUrl(configId);
  if (!url) return { streams: [], chName: '' };

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const eventos = [];

    $('table tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      const dia = $(tds[0]).text().trim();
      const hora = $(tds[1]).text().trim();
      const deporte = $(tds[2]).text().trim();
      const competicion = $(tds[3]).text().trim();
      const partido = $(tds[4]).text().trim();

      const canales = [];
      $(tds[5]).find('a').each((_, a) => {
        const href = $(a).attr('href');
        const label = $(a).text().trim();
        canales.push({ label, url: href });
      });

      eventos.push({ dia, hora, deporte, competicion, partido, canales });
    });

    const evento = eventos.find(ev =>
      `eventos_${ev.dia}_${ev.hora}_${ev.deporte}_${ev.partido}`.replace(/\s+/g, '_').replace(/[^\w]/g, '') === id
    );

    if (!evento) return { streams: [], chName: '' };

    const streams = evento.canales.map(canal => ({
      name: canal.label.split('-->').pop().trim(),
      title: `${evento.partido} (${evento.deporte})`,
      externalUrl: canal.url,
      behaviorHints: { notWebReady: true, external: true }
    }));

    return { streams, chName: evento.partido };
  } catch (err) {
    console.error('[EVENTOS] Error al scrapear streams:', err.message);
    return { streams: [], chName: '' };
  }
}

module.exports = { getStreams };
