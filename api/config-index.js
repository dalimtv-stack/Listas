module.exports = async (req, res) => {
  const { headers } = req;
  const token = headers.cookie?.match(/token=([^;]+)/)?.[1];

  if (!token) {
    return res.redirect(302, 'https://accounts.google.com/o/oauth2/v2/auth?client_id=TU_CLIENT_ID&redirect_uri=TU_REDIRECT_URI&response_type=token&scope=email');
  }

  const email = await validarToken(token);
  if (email !== 'tu-correo@gmail.com') {
    return res.status(403).send('Acceso denegado');
  }

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(`
    <html>
      <head><title>Panel de configuración</title></head>
      <body>
        <h1>Panel de configuración del addon</h1>
        <ul>
          <li><a href="/cleanup">🧹 Cleanup</a></li>
          <li><a href="/regenerate-posters">🎨 Regenerar posters</a></li>
          <li><a href="/upload-image">📤 Subir imagen</a></li>
          <li><a href="/Resolution">📐 Resolución</a></li>
        </ul>
      </body>
    </html>
  `);
};
