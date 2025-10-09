// api/regenerate-posters.js
const { fetchEventos } = require('../src/eventos/scraper-events');
const { scrapePostersForEventos } = require('../src/eventos/poster-events');
const { kvGetJsonTTL, kvSetJsonTTL, kvDelete } = require('./kv');
const { DateTime } = require('luxon');

module.exports = async function handler(req, res) {
  try {
    console.info('[RegeneratePosters] Iniciando regeneración de postersBlobHoy');

    const ahoraDT = DateTime.now().setZone('Europe/Madrid');
    const hoyStr = ahoraDT.toFormat('dd/MM/yyyy');
    const ayerStr = ahoraDT.minus({ days: 1 }).toFormat('dd/MM/yyyy');

    const cacheHoy = await kvGetJsonTTL('EventosHoy');

    // Si EventosHoy está caducado → mover a Ayer y borrar claves
    if (cacheHoy?.day === ayerStr) {
      console.info('[RegeneratePosters] EventosHoy está caducado, moviendo a EventosAyer y borrando claves');

      await kvSetJsonTTL('EventosAyer', {
        day: cacheHoy.day,
        data: cacheHoy.data?.data ?? cacheHoy.data ?? {}
      }, 86400);

      await kvDelete('EventosHoy');
      await kvDelete('EventosMañana');
    }

    // Scrapear eventos desde cero
    const eventos = await fetchEventos();

    if (!eventos || eventos.length === 0) {
      console.warn('[RegeneratePosters] No se encontraron eventos en scraping');
      return res.status(200).json({ message: 'No hay eventos que regenerar' });
    }

    // Re-scrapear posters
    const eventosConPosters = await scrapePostersForEventos(eventos);

    // Reescribir EventosHoy en KV
    const mapHoy = {};
    for (const ev of eventosConPosters) {
      const key = `${ev.partido}|${ev.hora}|${ev.dia}|${ev.competicion}`;
      mapHoy[key] = ev;
    }

    const diaSet = new Set(eventosConPosters.map(ev => ev.dia));
    const day = diaSet.size === 1 ? [...diaSet][0] : hoyStr;

    await kvSetJsonTTL('EventosHoy', { day, data: mapHoy }, 86400);

    console.info('[RegeneratePosters] Regeneración completada');
    res.status(200).json({
      message: 'EventosHoy, EventosAyer y postersBlobHoy regenerados',
      updated: eventosConPosters.length
    });
  } catch (err) {
    console.error('[RegeneratePosters] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
