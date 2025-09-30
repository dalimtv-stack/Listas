// pages/api/regenerate-posters.js
import { fetchEventos } from '../../src/eventos/scraper-events';
import { scrapePostersForEventos } from '../../src/eventos/poster-events';
import { kvSetJsonTTL } from '../../api/kv';

export default async function handler(req, res) {
  try {
    console.info('[RegeneratePosters] Iniciando regeneración de postersBlobHoy');
    const eventos = await fetchEventos();
    const eventosConPosters = await scrapePostersForEventos(eventos);
    console.info('[RegeneratePosters] Regeneración completada');
    res.status(200).json({ message: 'postersBlobHoy regenerado', eventos: eventosConPosters });
  } catch (err) {
    console.error('[RegeneratePosters] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
