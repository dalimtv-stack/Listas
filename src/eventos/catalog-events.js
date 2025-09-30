// src/eventos/catalog-events.js
async function getCatalog(configId) {
  console.time(`[CATALOG EVENTS] Generación catálogo ${configId}`);

  const configData = await kvGetJson(configId);
  const url = configData?.eventosUrl;
  if (!url) {
    console.timeEnd(`[CATALOG EVENTS] Generación catálogo ${configId}`);
    return [];
  }

  const eventos = await fetchEventos(url);
  const catalogo = eventos.map(ev => ({
    id: `Heimdallr_evt_${configId}_${normalizeId(ev)}`,
    type: 'tv',
    name: `${ev.partido} (${ev.deporte})`,
    poster: ev.poster || `https://dummyimage.com/300x450/000/fff&text=${encodeURIComponent(ev.hora)}`,
    description: `${ev.hora} · ${ev.dia} · ${ev.competicion} (${ev.deporte})`,
    background: null
  }));

  console.timeEnd(`[CATALOG EVENTS] Generación catálogo ${configId}`);
  return catalogo;
}
