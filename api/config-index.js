const fetch = require('node-fetch');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL;
const REDIRECT_URI = 'https://TU_DOMINIO.vercel.app/api/config-index'; // ← cambia esto

module.exports = async (req, res) => {
  const { query } = req;

  // Si viene con código OAuth, intercambiar por token
  if (query.code) {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: query.code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenRes.json();
    const idToken = tokenData.id_token;

    const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
    const info = await infoRes.json();

    if (info.email !== ALLOWED_EMAIL) {
      return res.status(403).send('Acceso denegado');
    }

    return res.status(200).send(`
      <html>
        <head><title>Panel de configuración</title></head>
        <body>
          <h1>Bienvenido, ${info.name}</h1>
          <ul>
            <li><a href="/cleanup">🧹 Cleanup</a></li>
            <li><a href="/regenerate-posters">🎨 Regenerar posters</a></li>
            <li><a href="/upload-image">📤 Subir imagen</a></li>
            <li><a href="/Resolution">📐 Resolución</a></li>
          </ul>
        </body>
      </html>
    `);
  }

  // Si no hay código, redirigir al login
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=email%20profile`;

  res.writeHead(302, { Location: authUrl });
  res.end();
};
