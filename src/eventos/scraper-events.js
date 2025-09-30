// src/eventos/scraper-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { scrapePostersForEventos } = require('./poster-events');
const { DateTime } = require('luxon');

function parseFechaMarca(texto, añoPorDefecto) {
  const meses = {
    enero: '01', febrero: '02', marzo: '03', abril: '04',
    mayo: '05', junio: '06', julio: '07', agosto: '08',
    septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
  };

  const lower = (texto || '').toLowerCase().trim();

  // Formato esperado tras limpiar el <strong>: "30 de septiembre de 2025"
  const matchCompleto = lower.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/);
  if (matchCompleto) {
    const [_, dd, mes, yyyy] = matchCompleto;
    const mm = meses[mes];
    if (!mm) return '';
    return `${yyyy}-${mm}-${dd.padStart(2, '0')}`;
  }

  // Alternativa sin año (no debería ocurrir con el HTML que pasaste)
  const matchSinAnio = lower.match(/(\d{1,2})\s+de\s+(\w+)/);
  if (matchSinAnio) {
    const [_, dd, mes] = matchSinAnio;
    const mm = meses[mes];
    if (!mm) return '';
    const yyyy = añoPorDefecto || new Date().getFullYear();
    return `${yyyy}-${mm}-${dd.padStart(2, '0')}`;
  }

  console.warn(`[EVENTOS] No se pudo parsear fecha: "${texto}" → "${lower}"`);
  return '';
}

function formatoFechaES(fecha) {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(fecha);
}

function eventoEsReciente(dia, hora) {
  try {
    const ahora = DateTime.now().setZone('Europe/Madrid');

    const eventoFecha = DateTime.fromFormat(String(dia || ''), 'dd/MM/yyyy', { zone: 'Europe/Madrid' });
    const [hh, min] = String(hora || '').split(':');
    const evento = eventoFecha.set({
      hour: parseInt(hh || '0', 10),
      minute: parseInt(min || '0', 10)
    });

    if (!evento.isValid) return false;

    const hoyISO = ahora.toISODate();
    const ayerISO = ahora.minus({ days: 1 }).toISODate();
    const mañanaISO = ahora.plus({ days: 1 }).toISODate();
    const eventoISODate = evento.toISODate();

    const diffHorasPasado = ahora.diff(evento, 'hours').hours;

    // HOY
    if (eventoISODate === hoyISO) {
      if (ahora.hour < 3) return true; // 00:00–02:59 → todo el día
      const umbralPasado3h = ahora.minus({ hours: 3 });
      return evento.toMillis() >= umbralPasado3h.toMillis();
    }

    // AYER → solo si su hora está como mucho 2h en el pasado
    if (eventoISODate === ayerISO) {
      const umbralAyer2h = ahora.minus({ hours: 2 });
      return evento.toMillis() >= umbralAyer2h.toMillis();
    }

    // MAÑANA → solo a partir de las 22:00, y dentro de próximas 3 horas
    if (eventoISODate === mañanaISO) {
      if (ahora.hour < 22) return false;
      const umbralFuturo3h = ahora.plus({ hours: 3 });
      return evento.toMillis() >= ahora.toMillis() && evento.toMillis() <= umbralFuturo3h.toMillis();
    }

    return false;
  } catch (e) {
    console.warn('[EVENTOS] Error en eventoEsReciente', e);
    return false;
  }
}

async function fetchEventos(url) {
  const eventos = [];
  const eventosUnicos = new Set();

  const ahoraDT = DateTime.now().setZone('Europe/Madrid');
  const hoyISO = ahoraDT.toISODate();
  const fechaFormateada = formatoFechaES(ahoraDT.toJSDate());

  console.info(`[EVENTOS] Fecha del sistema: ${fechaFormateada} (${hoyISO})`);

  try {
    const MARCA_URL = 'https://www.marca.com/programacion-tv.html';
    const res = await fetch(MARCA_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; scraper)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} en Marca`);
    const buffer = await res.buffer();
    const html = iconv.decode(buffer, 'latin1');
    const $ = cheerio.load(html);

    const bloques = $('li.content-item').filter((i, el) => $(el).find('.title-section-widget').length > 0);
    if (bloques.length === 0) {
      console.warn('[EVENTOS] No se encontraron bloques con fecha válida');
      return [crearFallback(hoyISO)];
    }

    console.info('[EVENTOS] Estructura detectada: daylist / dailyevent');

    bloques.each((_, li) => {
      // EXTRAER fecha limpia removiendo el <strong> del día de la semana
      const fechaTexto = $(li)
        .find('.title-section-widget')
        .clone()
        .children('strong')
        .remove()
        .end()
        .text()
        .trim();

      const fechaISO = parseFechaMarca(fechaTexto, ahoraDT.year);
      if (!fechaISO) {
        console.warn(`[EVENTOS] Fecha de bloque inválida: "${fechaTexto}"`);
        return;
      }

      const fechaBloque = DateTime.fromISO(fechaISO, { zone: 'Europe/Madrid' });
      const diffDias = fechaBloque.startOf('day').diff(ahoraDT.startOf('day'), 'days').days;

      // Corte duro: solo ayer (-1), hoy (0) y mañana (+1)
      if (diffDias < -1 || diffDias > 1) {
        console.info(`[EVENTOS] Bloque descartado (${fechaISO}), fuera de rango`);
        return;
      }

      console.info(`[EVENTOS] Bloque aceptado: ${fechaISO}`);

      const [yyyy, mm, dd] = fechaISO.split('-');
      const fechaFormateadaMarca = `${dd}/${mm}/${yyyy}`;

      let eventosCuentaBloque = 0;

      $(li).find('li.dailyevent').each((_, eventoLi) => {
        const hora = $(eventoLi).find('.dailyhour').text().trim() || '';
        const deporte = $(eventoLi).find('.dailyday').text().trim() || '';
        const competicion = $(eventoLi).find('.dailycompetition').text().trim() || '';
        const partido = $(eventoLi).find('.dailyteams').text().trim() || '';
        const canal = $(eventoLi).find('.dailychannel').text().trim() || '';

        const eventoId = `${fechaISO}|${hora}|${partido}|${competicion}`;
        if (eventosUnicos.has(eventoId)) return;
        eventosUnicos.add(eventoId);

        if (!eventoEsReciente(fechaFormateadaMarca, hora)) return;

        eventos.push({
          dia: fechaFormateadaMarca,
          hora,
          deporte,
          competicion,
          partido,
          canales: [{ label: canal, url: null }]
        });
        eventosCuentaBloque++;
      });

      console.info(`[EVENTOS] Eventos aceptados en bloque ${fechaISO}: ${eventosCuentaBloque}`);
    });

    console.info(`[EVENTOS] Scrapeo finalizado desde Marca: ${eventos.length} eventos`);
  } catch (err) {
    console.warn(`[EVENTOS] Fallo al scrapear Marca: ${err.message}`);
  }

  if (eventos.length === 0) {
    console.warn(`[EVENTOS] No se encontraron eventos para hoy (${hoyISO})`);
    return [crearFallback(hoyISO)];
  }

  const eventosConPoster = await scrapePostersForEventos(eventos);
  return eventosConPoster;
}

function crearFallback(hoyISO) {
  const dia = `${hoyISO.slice(8, 10)}/${hoyISO.slice(5, 7)}/${hoyISO.slice(0, 4)}`;
  const texto = 'No hay eventos disponibles hoy';
  return {
    dia,
    hora: '',
    deporte: '',
    competicion: texto,
    partido: texto,
    canales: [],
    poster: `https://dummyimage.com/300x450/000/fff&text=${encodeURIComponent(texto)}`
  };
}

module.exports = { fetchEventos };
