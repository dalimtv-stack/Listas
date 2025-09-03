const { addonBuilder, getRouter } = require('stremio-addon-sdk');

const manifest = {
  id: 'org.stremio.Heimdallr',
  version: '1.2.123',
  name: 'Heimdallr Channels',
  description: 'Addon para cargar canales Acestream o M3U8 desde una lista M3U.',
  types: ['tv'],
  logo: "https://play-lh.googleusercontent.com/daJbjIyFdJ_pMOseXNyfZuy2mKOskuelsyUyj6AcGb0rV0sJS580ViqOTcSi-A1BUnI=w480-h960",
  catalogs: [
    {
      type: 'tv',
      id: 'Heimdallr',
      name: 'Heimdallr Live Channels',
      extra: [
        { name: 'genre', isRequired: false, options: ['Adultos', 'Elcano.top', 'Hulu.to', 'NEW LOOP', 'Noticias', 'Shickat.me', 'Telegram'] },
        { name: 'search', isRequired: false }
      ]
    }
  ],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['heimdallr_']
};

console.log('Manifest generado:', JSON.stringify(manifest, null, 2));

const builder = new addonBuilder(manifest);

module.exports = (req, res) => {
  const addonInterface = builder.getInterface();
  const router = getRouter(addonInterface);
  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
