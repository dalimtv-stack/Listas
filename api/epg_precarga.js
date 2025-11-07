const { kvSetJsonTTLIfChanged } = require('./kv');
const { parsearXMLTV } = require('./parsear');

const TTL = 24 * 3600;

async function precargarTodosLosEPG() {
  console.log('[EPG] Iniciando precarga completa de EPG');

  let todos;
  try {
    todos = await parsearXMLTV();
  } catch (err) {
    console.error('[EPG] Error al parsear XMLTV:', err.message);
    return;
  }

  const canales = Object.keys(todos);
  console.log('[EPG] Canales encontrados en XMLTV:', canales.length);

  for (const canalId of canales) {
    const eventos = todos[canalId];
    if (!Array.isArray(eventos) || eventos.length === 0) {
      console.warn('[EPG] Canal sin eventos:', canalId);
      continue;
    }

    await kvSetJsonTTLIfChanged(`epg:${canalId}`, eventos, TTL);
    console.log('[EPG] KV actualizado para', canalId, '→', eventos.length, 'eventos');
  }

  console.log('[EPG] Precarga completa finalizada');
}

module.exports = { precargarTodosLosEPG };
