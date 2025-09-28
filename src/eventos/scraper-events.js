// src/eventos/scraper-events.js
'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { scrapePosterForMatch, generatePlaceholdPoster } = require('./poster-events');
const { DateTime } = require('luxon');

function parseFechaMarca(texto) {
  const meses = {
    enero: '01', febrero: '02', marzo: '03', abril: '04',
    mayo: '05', junio: '06', julio: '07', agosto: '08',
    septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
  };
  const matches = (texto || '').toLowerCase().match(/(\d{1,2} de \w+ de \d{4})/g) || [];
  if (matches.length !== 1) {
    console.warn(`[EVENTOS] Fecha no válida o contiene múltiples fechas: "${texto}" (encontradas: ${matches.length})`);
    return '';
  }
  const match = (texto || '').toLowerCase().match(/(\d{1,2}) de (\w+) de (\d{4})/);
  if (!match) return '';
  const [_, dd, mes, yyyy] = match;
  const mm = meses[mes] || '01';
  return `${yyyy}-${mm}-${dd.padStart(2, '0')}`;
}

function formatoFechaES(fecha) {
  const opciones = {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  };
  return new Intl.DateTimeFormat('es-ES', opciones).format(fecha);
}

function eventoEsReciente(dia, hora, deporte, partido, hoyISO) {
  try {
    const [dd, mm, yyyy] = (dia || '').split('/');
    const [hh, min] = (hora || '').split(':');
    const evento = DateTime.fromObject({
      year: parseInt(yyyy),
      month: parseInt(mm),
      day: parseInt(dd),
      hour: parseInt(hh) || 0,
      minute: parseInt(min) || 0
    }, { zone: 'Europe/Madrid' });

    const ahora = DateTime.now().setZone('Europe/Madrid');
    const diffHoras = ahora.diff(evento, 'hours').hours;
    const eventoISO = evento.toISODate();

    console.info(`[EVENTOS] Evaluando evento: ${partido} a las ${hora} (${deporte}). Fecha: ${eventoISO}, Diff horas: ${diffHoras}`);

    // Verificar que el evento sea del día actual
    if (eventoISO !== hoyISO) {
      console.info(`[EVENTOS] Evento ${partido} descartado (fecha ${eventoISO} no coincide con ${hoyISO})`);
      return false;
    }

    if (deporte === 'Fútbol' && partido && partido.includes('Real Madrid')) {
      console.info(`[EVENTOS] Incluyendo evento con Real Madrid: ${partido}`);
      return true;
    }

    // Incluir todos los eventos futuros del día y los pasados recientes
    const limite = deporte === 'Fútbol' ? 2 : 3;
    return diffHoras <= limite;  // Positivo para pasados, negativo para futuros
  } catch (e) {
    console.warn('[EVENTOS] Error en eventoEsReciente, aceptando por seguridad', e);
    return true;
  }
}

async function fetchEventos(url) {
  const eventos = [];
  const generos = [];
  const eventosUnicos = new Set();

  // Fecha local en Madrid (evita problemas de toISOString UTC)
  const ahoraDT = DateTime.now().setZone('Europe/Madrid');
  const hoyISO = ahoraDT.toISODate();
  const fechaFormateada = formatoFechaES(ahoraDT.toJSDate());

  console.info(`[EVENTOS] Fecha del sistema: ${fechaFormateada} (${hoyISO})`);

  try {
    const MARCA_URL = 'https://www.marca.com/programacion-tv.html'; // tu URL original
    const res = await fetch(MARCA_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; scraper)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} en Marca`);
    const buffer = await res.buffer();

    // Intentamos UTF-8 primero (muchas páginas vienen en UTF-8), si no hay estructura, probamos latin1
    let html = buffer.toString('utf8');
    let $ = cheerio.load(html);

    const looksLikeDaylist = ($('ol.auto-items.daylist').length > 0) || ($('li.dailyevent').length > 0) || ($('.title-section-widget').length > 0);
    const looksLikeOld = ($('h3').length > 0 && $('ol.events-list').length > 0) || ($('li.event-item').length > 0);

    if (!looksLikeDaylist && !looksLikeOld) {
      // fallback a latin1 si no hemos detectado nada útil con utf8
      html = iconv.decode(buffer, 'latin1');
      $ = cheerio.load(html);
    }

    // Re-evaluar estructuras después del fallback
    const hasDaylist = ($('ol.auto-items.daylist').length > 0) || ($('li.dailyevent').length > 0) || ($('.title-section-widget').length > 0);
    const hasOldStructure = ($('h3').length > 0 && $('ol.events-list').length > 0) || ($('li.event-item').length > 0);

    // --- 1) Si hay la estructura "daylist / dailyevent" (más moderna) ---
    if (hasDaylist) {
      console.info('[EVENTOS] Estructura detectada: daylist / dailyevent');

      // Recorremos bloques tipo "content-item" que contienen .title-section-widget
      $('li.content-item').filter((i, el) => $(el).find('.title-section-widget').length > 0).each((_, li) => {
        const fechaTexto = $(li).find('.title-section-widget').text().trim();
        const fechaISO = parseFechaMarca(fechaTexto);

        console.info(`[EVENTOS] Bloque con fecha detectada: ${fechaISO} (texto: "${fechaTexto.replace(/\s+/g,' ').trim().slice(0,60)}")`);

        // Si el bloque no es de hoy, saltamos (pero seguimos con los siguientes bloques)
        if (fechaISO !== hoyISO) {
          console.info(`[EVENTOS] Saltando bloque con fecha ${fechaISO} (no coincide con ${hoyISO})`);
          return;
        }

        console.info(`[EVENTOS] Procesando bloque con fecha ${fechaISO}`);
        const [yyyy, mm, dd] = fechaISO.split('-');
        const fechaFormateadaMarca = `${dd}/${mm}/${yyyy}`;

        // Encontrar cada evento dentro del bloque
        $(li).find('li.dailyevent').each((_, eventoLi) => {
          const hora = $(eventoLi).find('.dailyhour').text().trim() || $(eventoLi).find('.hour').text().trim() || '';
          const deporte = $(eventoLi).find('.dailyday').text().trim() || $(eventoLi).find('.sport').text().trim() || '';
          const competicion = $(eventoLi).find('.dailycompetition').text().trim() || $(eventoLi).find('.competition').text().trim() || '';
          const partido = $(eventoLi).find('.dailyteams').text().trim() || $(eventoLi).find('h4').text().trim() || '';
          const canal = $(eventoLi).find('.dailychannel').text().trim() || $(eventoLi).find('.channel').text().trim() || '';

          const eventoId = `${fechaISO}|${hora}|${partido}|${competicion}`;
          if (eventosUnicos.has(eventoId)) {
            console.info(`[EVENTOS] Evento duplicado descartado: ${partido} a las ${hora}`);
            return;
          }
          eventosUnicos.add(eventoId);

          if (!eventoEsReciente(fechaFormateadaMarca, hora, deporte, partido, hoyISO)) {
            console.info(`[EVENTOS] Evento ${partido} a las ${hora} descartado (no reciente)`);
            return;
          }
          if (deporte && !generos.includes(deporte)) generos.push(deporte);

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
    }

    // --- 2) Si existe la estructura antigua h3 + ol.events-list ---
    if (hasOldStructure) {
      console.info('[EVENTOS] Estructura detectada: h3 + ol.events-list (antiguo)');
      $('h3').each((_, h3) => {
        const fechaTexto = $(h3).text().trim();
        const fechaISO = parseFechaMarca(fechaTexto);

        console.info(`[EVENTOS] Bloque con fecha detectada: ${fechaISO} (h3: "${fechaTexto.replace(/\s+/g,' ').trim().slice(0,60)}")`);

        if (fechaISO !== hoyISO) {
          console.info(`[EVENTOS] Saltando bloque con fecha ${fechaISO} (no coincide con ${hoyISO})`);
          return; // sigue con siguiente h3
        }

        console.info(`[EVENTOS] Procesando bloque con fecha ${fechaISO}`);
        const [yyyy, mm, dd] = fechaISO.split('-');
        const fechaFormateadaMarca = `${dd}/${mm}/${yyyy}`;

        const ol = $(h3).next('ol.events-list');
        ol.find('li.event-item').each((_, eventoLi) => {
          const hora = $(eventoLi).find('.hour').text().trim() || '';
          const deporte = $(eventoLi).find('.sport').text().trim() || '';
          const competicion = $(eventoLi).find('.competition').text().trim() || '';
          const partido = $(eventoLi).find('h4').text().trim() || '';
          const canal = $(eventoLi).find('.channel').text().trim() || '';

          const eventoId = `${fechaISO}|${hora}|${partido}|${competicion}`;
          if (eventosUnicos.has(eventoId)) {
            console.info(`[EVENTOS] Evento duplicado descartado: ${partido} a las ${hora}`);
            return;
          }
          eventosUnicos.add(eventoId);

          if (!eventoEsReciente(fechaFormateadaMarca, hora, deporte, partido, hoyISO)) {
            console.info(`[EVENTOS] Evento ${partido} a las ${hora} descartado (no reciente)`);
            return;
          }
          if (deporte && !generos.includes(deporte)) generos.push(deporte);

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
    }

    console.info(`[EVENTOS] Scrapeo finalizado desde Marca: ${eventos.length} eventos`);
  } catch (err) {
    console.warn(`[EVENTOS] Fallo al scrapear Marca: ${err.message}`);
  }

  if (eventos.length === 0) {
    console.warn(`[EVENTOS] No se encontraron eventos para hoy (${hoyISO})`);
    const fallback = {
      dia: `${hoyISO.slice(8, 10)}/${hoyISO.slice(5, 7)}/${hoyISO.slice(0, 4)}`,
      hora: '',
      deporte: '',
      competicion: '',
      partido: 'No hay eventos disponibles hoy',
      canales: [],
      poster: generatePlaceholdPoster({
        hora: '',
        deporte: '',
        competicion: 'No hay eventos disponibles hoy'
      })
    };
    return [fallback];
  }

  // Generar posters (igual que antes)
  await Promise.all(eventos.map(async (evento, index) => {
    const posterLabel = `Poster ${evento.partido}-${index}`;
    console.time(posterLabel);
    evento.poster = await scrapePosterForMatch({
      partido: evento.partido,
      hora: evento.hora,
      deporte: evento.deporte,
      competicion: evento.competicion
    });
    console.timeEnd(posterLabel);
  }));

  return eventos;
}

module.exports = { fetchEventos };