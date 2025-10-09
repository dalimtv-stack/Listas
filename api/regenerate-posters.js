// api/regenerate-posters.js
const { fetchEventos } = require('../src/eventos/scraper-events');
const { scrapePostersForEventos } = require('../src/eventos/poster-events');
const { kvGetJsonTTL, kvSetJsonTTL } = require('./kv');

module.exports = async function handler(req, res) {
  try {
    console.info('[RegeneratePosters] Iniciando regeneración de postersBlobHoy');

    // 1. Intentar leer EventosHoy de KV
    let cacheHoy = await kvGetJsonTTL('EventosHoy');
    let eventos = cacheHoy && cacheHoy.data ? Object.values(cacheHoy.data) : null;

    // 2. Si no hay datos en KV, scrapear con fetchEventos()
    if (!eventos || eventos.length === 0) {
      console.info('[RegeneratePosters] KV vacío, llamando a fetchEventos()');
      eventos = await fetchEventos();
    }

    if (!eventos || eventos.length === 0) {
      console.warn('[RegeneratePosters] No se encontraron eventos ni en KV ni en scraping');
      return res.status(200).json({ message: 'No hay eventos que regenerar' });
    }

    // 3. Re-scrapear posters
    const eventosConPosters = await scrapePostersForEventos(eventos);

    // 4. Reescribir EventosHoy en KV
    const mapHoy = {};
    for (const ev of eventosConPosters) {
      const key = `${ev.partido}|${ev.hora}|${ev.dia}|${ev.competicion}`;
      mapHoy[key] = ev;
    }

    const diaSet = new Set(eventosConPosters.map(ev => ev.dia));
    const day = diaSet.size === 1 ? [...diaSet][0] : DateTime.now().setZone('Europe/Madrid').toFormat('dd/MM/yyyy');

    if (day) {
      await kvSetJsonTTL('EventosHoy', { day, data: mapHoy }, 86400);
    }

    console.info('[RegeneratePosters] Regeneración completada');
    res.status(200).json({
      message: 'EventosHoy y postersBlobHoy regenerados',
      updated: eventosConPosters.length
    });
  } catch (err) {
    console.error('[RegeneratePosters] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
