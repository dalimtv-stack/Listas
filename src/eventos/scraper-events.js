// src/eventos/scraper-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { scrapePostersConcurrenciaLimitada } = require('./poster-events');
const { kvGetJsonTTL } = require('../../api/kv');
const { DateTime } = require('luxon');

function parseFechaMarca(texto, añoPorDefecto) {
  const meses = {
    enero: '01', febrero: '02', marzo: '03', abril: '04',
    mayo: '05', junio: '06', julio: '07', agosto: '08',
    septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
  };

  let lower = (texto || '').toLowerCase().trim();
  // quitar día de la semana
  lower = lower.replace(/^(lunes|martes|miércoles|jueves|viernes|sábado|domingo)/, '').trim();
  // asegurar espacio antes de "de"
  lower = lower.replace(/(\d)(de)/, '$1 de');

  // "30 de septiembre de 2025"
  let match = lower.match(/(\d{1,2}) de (\w+) de (\d{4})/);
  if (match) {
    const [_, dd, mes, yyyy] = match;
    const mm = meses[mes];
    if (!mm) return '';
    return `${yyyy}-${mm}-${dd.padStart(2, '0')}`;
  }

  // "30 de septiembre" (sin año)
  match = lower.match(/(\d{1,2}) de (\w+)/);
  if (match) {
    const [_, dd, mes] = match;
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

    if (!evento.isValid) {
      console.warn(`[EVENTOS] Fecha u hora inválida: ${dia} ${hora}`);
      return false;
    }

    const hoyISO = ahora.toISODate();
    const ayerISO = ahora.minus({ days: 1 }).toISODate();
    const mañanaISO = ahora.plus({ days: 1 }).toISODate();
    const eventoISODate = evento.toISODate();

    const diffHorasPasado = ahora.diff(evento, 'hours').hours;
    const diffHorasFuturo = evento.diff(ahora, 'hours').hours;

    // HOY
    if (eventoISODate === hoyISO) {
      if (ahora.hour < 3) {
        console.info(`[EVENTOS] Evento de hoy incluido (antes de 03:00): ${eventoISODate} ${hora}`);
        return true;
      }
      const umbralPasado3h = ahora.minus({ hours: 3 });
      const reciente = evento.toMillis() >= umbralPasado3h.toMillis();
      console.info(`[EVENTOS] Evento de hoy ${eventoISODate} ${hora}: ${reciente ? 'incluido' : 'descartado'} (diff: ${diffHorasPasado.toFixed(2)} horas)`);
      return reciente;
    }

    // AYER
    if (eventoISODate === ayerISO) {
      const umbralAyer2h = ahora.minus({ hours: 2 });
      const reciente = evento.toMillis() >= umbralAyer2h.toMillis();
      console.info(`[EVENTOS] Evento de ayer ${eventoISODate} ${hora}: ${reciente ? 'incluido' : 'descartado'} (diff: ${diffHorasPasado.toFixed(2)} horas)`);
      return reciente;
    }

    // MAÑANA
    if (eventoISODate === mañanaISO) {
      if (ahora.hour < 22) {
        console.info(`[EVENTOS] Evento de mañana descartado (antes de 22:00): ${eventoISODate} ${hora}`);
        return false;
      }
      const umbralFuturo3h = ahora.plus({ hours: 3 });
      const reciente = evento.toMillis() >= ahora.toMillis() && evento.toMillis() <= umbralFuturo3h.toMillis();
      console.info(`[EVENTOS] Evento de mañana ${eventoISODate} ${hora}: ${reciente ? 'incluido' : 'descartado'} (diff: ${diffHorasFuturo.toFixed(2)} horas)`);
      return reciente;
    }

    console.info(`[EVENTOS] Evento descartado: ${eventoISODate} no es ayer (${ayerISO}), hoy (${hoyISO}), ni mañana (${mañanaISO})`);
    return false;
  } catch (e) {
    console.warn(`[EVENTOS] Error en eventoEsReciente: ${e.message}`);
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
      const fechaTexto = $(li).find('.title-section-widget').text().trim();
      const fechaISO = parseFechaMarca(fechaTexto, ahoraDT.year);
      if (!fechaISO) {
        console.warn(`[EVENTOS] Fecha no válida: "${fechaTexto}"`);
        return;
      }

      // Corte duro: solo ayer, hoy y mañana
      const fechaBloque = DateTime.fromISO(fechaISO, { zone: 'Europe/Madrid' });
      const diffDias = fechaBloque.startOf('day').diff(ahoraDT.startOf('day'), 'days').days;
      if (diffDias < -1 || diffDias > 1) {
        console.info(`[EVENTOS] Saltando bloque con fecha ${fechaISO} (diffDias: ${diffDias})`);
        return;
      }

      const [yyyy, mm, dd] = fechaISO.split('-');
      const fechaFormateadaMarca = `${dd}/${mm}/${yyyy}`;

      $(li).find('li.dailyevent').each((_, eventoLi) => {
        const hora = $(eventoLi).find('.dailyhour').text().trim() || '';
        const deporte = $(eventoLi).find('.dailyday').text().trim() || '';
        const competicion = $(eventoLi).find('.dailycompetition').text().trim() || '';
        const partido = $(eventoLi).find('.dailyteams').text().trim() || '';
        const canal = $(eventoLi).find('.dailychannel').text().trim() || '';

        const eventoId = `${fechaISO}|${hora}|${partido}|${competicion}`;
        if (eventosUnicos.has(eventoId)) return;
        eventosUnicos.add(eventoId);

        console.info(`[EVENTOS] Evaluando evento: ${partido} a las ${hora} (${deporte}). Fecha: ${fechaISO}`);
        if (!eventoEsReciente(fechaFormateadaMarca, hora)) {
          console.info(`[EVENTOS] Evento descartado: ${partido} (${fechaFormateadaMarca} ${hora})`);
          return;
        }

        eventos.push({
          dia: fechaFormateadaMarca,
          hora,
          deporte,
          competicion,
          partido,
          canales: [{ label: canal, url: null }]
        });
      });
    });

    console.info(`[EVENTOS] Scrapeo finalizado desde Marca: ${eventos.length} eventos`);
  } catch (err) {
    console.warn(`[EVENTOS] Fallo al scrapear Marca: ${err.message}`);
  }

  if (eventos.length === 0) {
    console.warn(`[EVENTOS] No se encontraron eventos para hoy (${hoyISO})`);
    return [crearFallback(hoyISO)];
  }

  const eventosConPoster = await scrapePostersConcurrenciaLimitada(eventos);
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
