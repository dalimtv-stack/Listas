const crypto = require('crypto');
const getRawBody = require('raw-body');

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
  const cookies = req.headers.cookie || '';
  const token = cookies.match(/auth_token=([^;]+)/)?.[1];

  // === PANEL PRINCIPAL (autenticado) ===
  if (esTokenValido(token)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).end(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Panel de Configuración</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
    .card { transition: transform 0.2s, box-shadow 0.2s; }
    .card:hover { transform: translateY(-4px); box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); }
  </style>
</head>
<body class="bg-gradient-to-br from-slate-50 to-slate-100 min-h-screen flex items-center justify-center p-6">
  <div class="w-full max-w-2xl">
    <div class="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-slate-200">
      <div class="flex items-center justify-between mb-8">
        <h1 class="text-3xl font-bold text-slate-800">Panel de Configuración</h1>
        <div class="flex items-center gap-2 text-green-600">
          <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
          <span class="font-medium">${ALLOWED_EMAIL}</span>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <a href="/cleanup" class="card bg-gradient-to-r from-red-500 to-rose-600 text-white p-6 rounded-xl flex items-center gap-4 hover:shadow-lg">
          <div class="bg-white/20 p-3 rounded-lg">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </div>
          <div>
            <h3 class="font-semibold text-lg">Cleanup</h3>
            <p class="text-sm opacity-90">Limpiar caché y datos obsoletos</p>
          </div>
        </a>

        <a href="/regenerate-posters" class="card bg-gradient-to-r from-blue-500 to-cyan-600 text-white p-6 rounded-xl flex items-center gap-4 hover:shadow-lg">
          <div class="bg-white/20 p-3 rounded-lg">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          </div>
          <div>
            <h3 class="font-semibold text-lg">Regenerar Posters</h3>
            <p class="text-sm opacity-90">Actualizar imágenes de canales</p>
          </div>
        </a>

        <a href="/upload-image" class="card bg-gradient-to-r from-emerald-500 to-teal-600 text-white p-6 rounded-xl flex items-center gap-4 hover:shadow-lg">
          <div class="bg-white/20 p-3 rounded-lg">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
          </div>
          <div>
            <h3 class="font-semibold text-lg">Subir Imagen</h3>
            <p class="text-sm opacity-90">Añadir logos personalizados</p>
          </div>
        </a>

        <a href="/Resolution" class="card bg-gradient-to-r from-purple-500 to-indigo-600 text-white p-6 rounded-xl flex items-center gap-4 hover:shadow-lg">
          <div class="bg-white/20 p-3 rounded-lg">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
          </div>
          <div>
            <h3 class="font-semibold text-lg">Resolución</h3>
            <p class="text-sm opacity-90">Ajustar calidad de streams</p>
          </div>
        </a>
      </div>

      <div class="mt-8 text-center">
        <a href="/logout" class="text-slate-500 hover:text-slate-700 text-sm underline">Cerrar sesión</a>
      </div>
    </div>
  </div>
</body>
</html>
    `);
  }

  // === LOGIN (POST) ===
  if (req.method === 'POST') {
    const body = await getRawBody(req);
    const params = new URLSearchParams(body.toString());
    const email = params.get('email');
    const password = params.get('password');

    if (email === ALLOWED_EMAIL && password === ALLOWED_PASSWORD) {
      const firma = firmar(email);
      res.setHeader('Set-Cookie', `auth_token=${email}|${firma}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`);
      res.writeHead(302, { Location: '/Acceso' });
      return res.end();
    } else {
      return res.status(403).end(`
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Error</title>
<script src="https://cdn.tailwindcss.com"></script>
</head><body class="bg-red-50 min-h-screen flex items-center justify-center">
<div class="bg-white p-8 rounded-xl shadow-lg text-center">
  <svg class="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
  <h2 class="text-xl font-bold text-red-700">Acceso Denegado</h2>
  <p class="text-red-600 mt-2">Credenciales incorrectas</p>
  <a href="/Acceso" class="mt-4 inline-block text-blue-600 hover:underline">← Volver al login</a>
</div>
</body></html>
      `);
    }
  }

  // === PÁGINA DE LOGIN ===
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).end(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Login - Panel</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>body { font-family: 'Inter', sans-serif; }</style>
</head>
<body class="bg-gradient-to-br from-indigo-50 via-white to-purple-50 min-h-screen flex items-center justify-center p-6">
  <div class="w-full max-w-md">
    <div class="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-slate-200">
      <div class="text-center mb-8">
        <div class="bg-gradient-to-r from-indigo-500 to-purple-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg class="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
        </div>
        <h1 class="text-2xl font-bold text-slate-800">Acceso Restringido</h1>
        <p class="text-slate-600 mt-1">Introduce tus credenciales</p>
      </div>

      <form method="POST" action="/Acceso" class="space-y-5">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-2">Email</label>
          <input type="email" name="email" required autocomplete="email" 
                 class="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none">
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-2">Contraseña</label>
          <input type="password" name="password" required autocomplete="current-password"
                 class="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none">
        </div>
        <button type="submit" 
                class="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold py-3 rounded-lg hover:from-indigo-700 hover:to-purple-700 transform transition-all duration-200 hover:scale-[1.02] shadow-lg">
          Iniciar Sesión
        </button>
      </form>
    </div>
  </div>
</body>
</html>
  `);
};
