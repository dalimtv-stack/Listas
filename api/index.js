// api/index.js
'use strict';

const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const { buildManifest } = require('./handlers/manifest');
const { handleCatalog } = require('./handlers/catalog');
const { handleMeta } = require('./handlers/meta');
const { handleStream } = require('./handlers/stream');
const { configureGet, configurePost } = require('./handlers/configure');

const app = express();
const router = express.Router();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// -------------------- CORS --------------------
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// -------------------- Rutas MANIFEST --------------------
router.get('/manifest.json', async (req, res) => {
  try {
    const manifest = await buildManifest('default');
    res.json(manifest);
  } catch (e) {
    console.error('[MANIFEST] error al generar default:', e.message);
    res.status(500).json({});
  }
});

router.get('/:configId/manifest.json', async (req, res) => {
  try {
    const manifest = await buildManifest(req.params.configId);
    res.json(manifest);
  } catch (e) {
    console.error(`[MANIFEST] error al generar para ${req.params.configId}:`, e.message);
    res.status(500).json({});
  }
});

// ------------------- Rutas de catálogo -------------------
router.get('/:configId/catalog/:type/:rest(.+)\\.json', async (req, res) => {
  try {
    const result = await handleCatalog(req);
    res.json(result);
  } catch (e) {
    console.error('[CATALOG] route error:', e.message);
    res.status(200).json({ metas: [] });
  }
});

// --------------------- Rutas META ---------------------
router.get('/:configId/meta/:type/:id.json', async (req, res) => {
  try {
    const result = await handleMeta(req);
    res.json(result);
  } catch (e) {
    console.error('[META] route error:', e.message);
    res.status(200).json({ meta: null });
  }
});

// --------------------- Rutas STREAM ---------------------
router.get('/:configId/stream/:type/:id.json', async (req, res) => {
  try {
    const result = await handleStream(req);
    res.json(result);
  } catch (e) {
    console.error('[STREAM] route error:', e.message);
    res.status(200).json({ streams: [] });
  }
});

// ---------------------- Config web ----------------------
router.get('/configure', configureGet);
router.post('/generate-url', configurePost);

// -------------------- Mount & export --------------------
app.use(router);
module.exports = app;

if (require.main === module) {
  const { DEFAULT_PORT } = require('../src/config');
  app.listen(DEFAULT_PORT, () => console.log(`Heimdallr listening on http://localhost:${DEFAULT_PORT}`));
}
