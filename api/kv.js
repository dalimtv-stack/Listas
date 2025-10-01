// api/kv.js
'use strict';

const fetch = require('node-fetch');

const KV_TTL_MS = 60 * 60 * 1000; // 1 hora en milisegundos

async function kvGet(configId) {
  if (!configId) return null;
  try {
    const { CLOUDFLARE_KV_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID, CLOUDFLARE_KV_API_TOKEN } = process.env;
    if (!CLOUDFLARE_KV_ACCOUNT_ID || !CLOUDFLARE_KV_NAMESPACE_ID || !CLOUDFLARE_KV_API_TOKEN) return null;
    const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${CLOUDFLARE_KV_API_TOKEN}` } });
    return r.ok ? await r.text() : null;
  } catch (e) {
    console.error('[KV] get error:', e.message);
    return null;
  }
}

async function kvSet(configId, value) {
  const { CLOUDFLARE_KV_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID, CLOUDFLARE_KV_API_TOKEN } = process.env;
  if (!CLOUDFLARE_KV_ACCOUNT_ID || !CLOUDFLARE_KV_NAMESPACE_ID || !CLOUDFLARE_KV_API_TOKEN) {
    throw new Error('Cloudflare KV no configurado');
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}/values/${configId}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CLOUDFLARE_KV_API_TOKEN}`, 'Content-Type': 'text/plain' },
    body: value
  });
  if (!r.ok) throw new Error(`KV set failed: ${r.status}`);
}

async function kvGetJson(configId) {
  const raw = await kvGet(configId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function kvSetJson(configId, obj) {
  try {
    await kvSet(configId, JSON.stringify(obj));
  } catch (e) {
    console.error('[KV] setJson error:', e.message);
  }
}

async function kvGetJsonTTL(key) {
  const val = await kvGet(key);
  if (!val) return null;
  try {
    const parsed = JSON.parse(val);
    if (!parsed.timestamp || !parsed.data) return null;
    const age = Date.now() - parsed.timestamp;
    const ttlMs = parsed.ttlMs || KV_TTL_MS;
    if (age > ttlMs) {
      console.log(`[KV] Caducado (${Math.round(age / 60000)} min)`, key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

async function kvSetJsonTTL(key, obj, ttlSeconds = 3600) {
  const payload = {
    timestamp: Date.now(),
    ttlMs: ttlSeconds * 1000,
    data: obj
  };
  try {
    await kvSet(key, JSON.stringify(payload));
  } catch (e) {
    console.error('[KV] setJsonTTL error:', e.message);
  }
}

async function kvSetJsonTTLIfChanged(key, obj, ttlSeconds = 3600) {
  try {
    const existing = await kvGetJsonTTL(key);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(obj)) {
      const payload = {
        timestamp: Date.now(),
        ttlMs: ttlSeconds * 1000,
        data: obj
      };
      await kvSet(key, JSON.stringify(payload));
      console.log(`[KV] Actualizado ${key} (cambios detectados)`);
    } else {
      console.log(`[KV] Sin cambios en ${key}, no se escribe`);
    }
  } catch (e) {
    console.error('[KV] setJsonTTLIfChanged error:', e.message);
  }
}

async function kvDelete(key) {
  try {
    const { CLOUDFLARE_KV_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID, CLOUDFLARE_KV_API_TOKEN } = process.env;
    if (!CLOUDFLARE_KV_ACCOUNT_ID || !CLOUDFLARE_KV_NAMESPACE_ID || !CLOUDFLARE_KV_API_TOKEN) return;
    const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}/values/${key}`;
    const r = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${CLOUDFLARE_KV_API_TOKEN}` }
    });
    if (r.ok) console.log(`[KV] Borrada clave: ${key}`);
  } catch (e) {
    console.error('[KV] Error borrando clave:', e.message);
  }
}

// Lista las claves (función corregida)
async function kvListKeys(prefix = '') {
  try {
    const { CLOUDFLARE_KV_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID, CLOUDFLARE_KV_API_TOKEN } = process.env;
    if (!CLOUDFLARE_KV_ACCOUNT_ID || !CLOUDFLARE_KV_NAMESPACE_ID || !CLOUDFLARE_KV_API_TOKEN) {
      console.warn('[KV] Credenciales de Cloudflare KV no configuradas');
      return [];
    }

    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_KV_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}/keys`;
    const allKeys = [];
    let cursor = null;
    const limit = 1000; // máximo soportado por la API en una llamada

    while (true) {
      const url = `${baseUrl}?prefix=${encodeURIComponent(prefix)}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${CLOUDFLARE_KV_API_TOKEN}` }
      });

      if (!r.ok) {
        throw new Error(`KV list failed: ${r.status} ${r.statusText}`);
      }

      const json = await r.json();
      if (!json || !Array.isArray(json.result)) {
        throw new Error('KV list: respuesta inesperada');
      }

      const names = json.result.map(k => k.name);
      allKeys.push(...names);

      // registrar resumen (no imprimas objetos sensibles)
      console.info(`[KV] Recuperadas ${names.length} claves de la página actual (acumuladas: ${allKeys.length})`);

      // paginación: Cloudflare devuelve result_info.cursor para continuar
      const nextCursor = json.result_info && json.result_info.cursor;
      if (!nextCursor) break;
      cursor = nextCursor;
    }

    console.info(`[KV] Listado final: ${allKeys.length} claves${prefix ? ` (prefijo="${prefix}")` : ''}`);
    // opcional: mostrar nombres (solo si no son demasiadas)
    if (allKeys.length <= 3000) {
      console.info('[KV] Claves:', allKeys);
    } else {
      console.info('[KV] Claves: (demasiadas para listar, muestra primeras 3000)');
      console.info(allKeys.slice(0, 300));
    }

    return allKeys;
  } catch (e) {
    console.error('[KV] listKeys error:', e.message || e);
    return [];
  }
}


module.exports = {
  kvGet,
  kvSet,
  kvGetJson,
  kvSetJson,
  kvGetJsonTTL,
  kvSetJsonTTL,
  kvSetJsonTTLIfChanged,
  kvDelete,
  kvListKeys
};
