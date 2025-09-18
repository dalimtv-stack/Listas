// api/resolve.js
'use strict';

const { kvGet, kvGetJson } = require('./kv');
const { DEFAULT_M3U_URL } = require('../src/config');

async function resolveM3uUrl(configId) {
  const cfg = await kvGetJson(configId);
  if (cfg && cfg.m3uUrl) return cfg.m3uUrl;
  const kv = await kvGet(configId);
  if (kv) return kv;
  if (DEFAULT_M3U_URL) return DEFAULT_M3U_URL;
  return null;
}

async function resolveExtraWebs(configId) {
  try {
    const cfg = await kvGetJson(configId);
    const raw = (cfg && typeof cfg.extraWebs === 'string') ? cfg.extraWebs : '';
    if (!raw.trim()) return [];
    const split = raw.split(/[;|,\n]+/g).map(s => s.trim()).filter(Boolean).map(u => u.replace(/\/+$/, ''));
    const seen = new Set();
    const urls = [];
    for (const u of split) {
      try {
        const parsed = new URL(u);
        const norm = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
        if (!seen.has(norm)) {
          seen.add(norm);
          urls.push(norm);
        }
      } catch {
        console.warn(`[DEBUG] extraWeb inválida descartada: ${u}`);
      }
    }
    return urls;
  } catch (e) {
    console.error(`[DEBUG] Error resolviendo extraWebs para ${configId}:`, e.message);
    return [];
  }
}

module.exports = { resolveM3uUrl, resolveExtraWebs };
