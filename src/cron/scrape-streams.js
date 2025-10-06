'use strict';

const { DateTime } = require('luxon');
const { getChannels } = require('../db');
const { resolveM3uUrl } = require('../../api/resolve');
const { kvSetJsonTTL } = require('../../api/kv');
const { handleStreamInternal, enrichWithExtra } = require('../../api/handlers/stream');

async function scrapeAndCacheStreams() {
  const logPrefix = '[CRON]';
  console.log(logPrefix, 'Iniciando scrape a las', DateTime.now().setZone('Europe/Madrid').toLocaleString());

  const configListKV = await kvGetJsonTTL('ConfigList');
  const configIds = Array.isArray(configListKV?.data) ? configListKV.data : ['default'];


  for (const configId of configIds) {
    const m3uUrl = await resolveM3uUrl(configId);
    if (!m3uUrl) {
      console.warn(logPrefix, `No m3uUrl para ${configId}`);
      continue;
    }

    const channels = await getChannels({ m3uUrl });
    console.log(logPrefix, `Canales: ${channels.length} para ${configId}`);

    for (const channel of channels) {
      const id = `${ADDON_PREFIX}_${configId}_${channel.id}`;
      const result = await handleStreamInternal({ id, m3uUrl, configId });
      const enriched = await enrichWithExtra(result, configId, m3uUrl, true);

      enriched.streams = sortStreams(enriched.streams);

      const kvKey = `Streams:${channel.id}:${configId}`;
      await kvSetJsonTTL(kvKey, enriched, 86400);
      console.log(logPrefix, `Cacheado ${kvKey}: ${enriched.streams.length} streams`);
    }
  }

  console.log(logPrefix, 'Scrape finalizado');
}

function sortStreams(streams) {
  const priority = {
    'm3u8-no-vlc': 1,
    'acestream': 2,
    'vlc': 3,
    'browser': 4
  };

  return streams.sort((a, b) => priority[getStreamType(a)] - priority[getStreamType(b)]);
}

function getStreamType(stream) {
  if (stream.url && stream.url.endsWith('.m3u8') && !stream.name.includes('VLC')) return 'm3u8-no-vlc';
  if (stream.externalUrl && stream.externalUrl.startsWith('acestream://')) return 'acestream';
  if (stream.name.includes('VLC')) return 'vlc';
  return 'browser';
}

module.exports = async (req, res) => {
  try {
    await scrapeAndCacheStreams();
    res.status(200).send('Scrape ejecutado correctamente');
  } catch (err) {
    console.error('[SCRAPE ERROR]', err);
    res.status(500).send('Error al ejecutar scrape');
  }
};
