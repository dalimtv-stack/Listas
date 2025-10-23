const crypto = require('crypto');

const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL;
const ALLOWED_PASSWORD = process.env.ALLOWED_PASSWORD;
const COOKIE_SECRET = process.env.COOKIE_SECRET;

function firmar(email) {
  return crypto.createHmac('sha256', COOKIE_SECRET).update(email).digest('hex');
}

function esTokenValido(token) {
  const [email, firma] = (token || '').split('|');
  return email === ALLOWED_EMAIL && firma === firmar(email);
}

module.exports = async (req, res) => {
  const { method, query, headers } = req;

  const cookies = headers.cookie || '';
  const token = cookies.match(/auth_token=([^;]+)/)?.[1];

  if (esTokenValido(token)) {
    // Usuario autenticado
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(`
      <html>
        <head><title>Panel de configuración</title></head>
        <body>
          <h1>Bienvenido, ${ALLOWED_EMAIL}</h1>
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

  // Si viene con login
  if (query.email && query.password) {
    if (query.email === ALLOWED_EMAIL && query.password === ALLOWED_PASSWORD) {
      const firma = firmar(query.email);
      res.setHeader('Set-Cookie', `auth_token=${query.email}|${firma}; Path=/; HttpOnly; Max-Age=86400`);
      res.writeHead(302, { Location: '/config-index' });
      return res.end();
    } else {
      return res.status(403).send('Credenciales incorrectas');
    }
  }

  // Mostrar formulario de login
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(`
    <html>
      <head><title>Login</title></head>
      <body>
        <h2>Acceso restringido</h2>
        <form method="GET" action="/config-index">
          <label>Email:</label><br>
          <input type="text" name="email"><br>
          <label>Contraseña:</label><br>
          <input type="password" name="password"><br><br>
          <button type="submit">Entrar</button>
        </form>
      </body>
    </html>
  `);
};
