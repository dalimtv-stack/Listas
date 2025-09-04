// index.js
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const { getChannels, getChannel, loadM3U } = require('./src/db');
const { CACHE_TTL, DEFAULT_PORT, STREAM_PREFIX } = require('./src/config');
const bodyParser = require('body-parser');

const cache = new NodeCache({ stdTTL: CACHE_TTL });

// Cargar M3U al inicio con URL por defecto
loadM3U().then(() => {
  console.log('M3U cargado globalmente al inicio');
}).catch(err => {
  console.error('Error cargando M3U al inicio:', err.message);
});

const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.143', // 🔼 versión incrementada
  name: 'Heimdallr Channels',
  description: 'Addon para cargar canales Acestream o M3U8 desde una lista M3U proporcionada por el usuario.',
  types: ['tv'],
  logo: 'https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960',
  catalogs: [
    {
      type: 'tv',
      id: 'Heimdallr',
      name: 'Heimdallr Live Channels',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'genre', isRequired: false, options: ['Adultos', 'Elcano.top', 'Hulu.to', 'NEW LOOP', 'Noticias', 'Shickat.me', 'Telegram', 'Deportes', 'Movistar'] }
      ]
    }
  ],
  resources: ['stream', 'meta', 'catalog'],
  idPrefixes: [STREAM_PREFIX],
  behaviorHints: {
    configurable: true
  }
};

const builder = new addonBuilder(manifest);

// ... (todo tu código de handlers Catalog, Meta y Stream se queda igual)

// Manejar /configure y /generate-url
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

router.use(bodyParser.urlencoded({ extended: false }));

router.get('/configure', (req, res) => {
  console.log('Serving /configure');
  const manifestUrl = `${req.protocol}://${req.get('host')}/manifest.json`;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Configurar Heimdallr Channels</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; text-align: center; }
          button, a { display: inline-block; padding: 12px 20px; margin: 10px; font-size: 16px; border: none; border-radius: 6px; cursor: pointer; text-decoration: none; }
          .install { background: #4CAF50; color: white; }
          .copy { background: #2196F3; color: white; }
        </style>
        <script>
          function copyManifest() {
            navigator.clipboard.writeText("${manifestUrl}")
              .then(() => alert("📋 URL copiada: ${manifestUrl}"))
              .catch(err => alert("Error al copiar: " + err));
          }
        </script>
      </head>
      <body>
        <h1>Heimdallr Channels</h1>
        <p>Puedes instalar este addon en Stremio o copiar la URL JSON:</p>
        <a class="install" href="stremio://${manifestUrl}">📥 Instalar en Stremio</a>
        <button class="copy" onclick="copyManifest()">📋 Copiar JSON</button>
      </body>
    </html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.end(html);
});

// (tu endpoint /generate-url se queda igual)

// Server
if (process.env.NODE_ENV !== 'production') {
  const { serveHTTP } = require('stremio-addon-sdk');
  serveHTTP(builder.getInterface(), { port: process.env.PORT || DEFAULT_PORT });
}

module.exports = (req, res) => {
  console.log('Request received:', req.url);
  router(req, res, () => {
    console.log('Route not found:', req.url);
    res.statusCode = 404;
    res.end();
  });
};
