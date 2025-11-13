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
  <title>Heimdallr Channels</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
    .card { transition: all 0.3s ease; }
    .card:hover { transform: translateY(-6px); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
    @keyframes pulse-live {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    .live-badge {
      animation: pulse-live 2s infinite;
    }
  </style>
</head>
<body class="bg-black text-white min-h-screen">
  <!-- TÍTULO GRANDE ARRIBA -->
  <div class="text-center py-10">
    <h1 class="text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
      Heimdallr Channels
    </h1>
    <p class="text-gray-400 mt-2 text-lg">Panel de Control</p>
  </div>
  <div class="flex items-center justify-center p-6">
    <div class="w-full max-w-2xl">
      <div class="bg-gray-900/80 backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-gray-800">
        <div class="flex items-center justify-between mb-8">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center">
              <svg class="w-6 h-6 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
              </svg>
            </div>
            <span class="font-medium text-green-400">${ALLOWED_EMAIL}</span>
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <a href="/cleanup" class="card bg-gradient-to-br from-red-600 to-rose-700 p-6 rounded-xl flex items-center gap-4 hover:shadow-2xl border border-red-800/50">
            <div class="bg-white/10 p-3 rounded-lg">
              <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </div>
            <div>
              <h3 class="font-bold text-lg">Cleanup</h3>
              <p class="text-sm opacity-80">Eliminar caché y datos antiguos</p>
            </div>
          </a>
          <a href="/regenerate-posters" class="card bg-gradient-to-br from-cyan-600 to-blue-700 p-6 rounded-xl flex items-center gap-4 hover:shadow-2xl border border-cyan-800/50">
            <div class="bg-white/10 p-3 rounded-lg">
              <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            </div>
            <div>
              <h3 class="font-bold text-lg">Regenerar Posters</h3>
              <p class="text-sm opacity-80">Actualizar imágenes</p>
            </div>
          </a>
          <a href="/upload-image" class="card bg-gradient-to-br from-emerald-600 to-teal-700 p-6 rounded-xl flex items-center gap-4 hover:shadow-2xl border border-emerald-800/50">
            <div class="bg-white/10 p-3 rounded-lg">
              <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
            </div>
            <div>
              <h3 class="font-bold text-lg">Subir Imagen</h3>
              <p class="text-sm opacity-80">Añadir logos personalizados</p>
            </div>
          </a>
          <a href="/Resolution" class="card bg-gradient-to-br from-purple-600 to-indigo-700 p-6 rounded-xl flex items-center gap-4 hover:shadow-2xl border border-purple-800/50">
            <div class="bg-white/10 p-3 rounded-lg">
              <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
            </div>
            <div>
              <h3 class="font-bold text-lg">Resolución</h3>
              <p class="text-sm opacity-80">Configurar calidad</p>
            </div>
          </a>
          <!-- GUÍA TV CON BADGE LIVE -->
          <a href="https://davidmuma.github.io/EPG/" target="_blank" class="card bg-gradient-to-br from-orange-600 to-amber-700 p-6 rounded-xl flex items-center gap-4 hover:shadow-2xl border border-orange-800/50 relative">
            <div class="bg-white/10 p-3 rounded-lg">
              <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
              </svg>
            </div>
            <div class="flex-1">
              <h3 class="font-bold text-lg flex items-center gap-2">
                Guía TV
                <span class="live-badge inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-600 text-white">
                  LIVE
                </span>
              </h3>
              <p class="text-sm opacity-80">Programación completa</p>
            </div>
          </a>

          <!-- NUEVO: EDITOR M3U -->
          <a href="/editor" class="card bg-gradient-to-br from-indigo-600 to-purple-700 p-6 rounded-xl flex items-center gap-4 hover:shadow-2xl border border-indigo-800/50">
            <div class="bg-white/10 p-3 rounded-lg">
              <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
              </svg>
            </div>
            <div>
              <h3 class="font-bold text-lg">Editor M3U</h3>
              <p class="text-sm opacity-80">Editar lista en GitHub</p>
            </div>
          </a>

        </div>
        <div class="mt-8 text-center">
          <a href="/logout" class="text-gray-400 hover:text-white text-sm underline transition-colors">Cerrar sesión</a>
        </div>
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
</head><body class="bg-black min-h-screen flex items-center justify-center p-6">
<div class="bg-red-900/50 backdrop-blur-sm border border-red-800 p-8 rounded-xl text-center max-w-sm">
  <svg class="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
  <h2 class="text-2xl font-bold text-red-400">Acceso Denegado</h2>
  <p class="text-red-300 mt-2">Credenciales incorrectas</p>
  <a href="/Acceso" class="mt-6 inline-block text-cyan-400 hover:text-cyan-300 underline">Volver al login</a>
</div>
</body></html>
      `);
    }
  }

  // === PÁGINA DE LOGIN (fondo negro) ===
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).end(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Heimdallr Channels - Login</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>body { font-family: 'Inter', sans-serif; }</style>
</head>
<body class="bg-black text-white min-h-screen flex items-center justify-center p-6">
  <!-- TÍTULO GRANDE -->
  <div class="absolute top-10 left-1/2 transform -translate-x-1/2 text-center">
    <h1 class="text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
      Heimdallr Channels
    </h1>
    <p class="text-gray-500 mt-2">Acceso Seguro</p>
  </div>
  <div class="w-full max-w-md mt-32">
    <div class="bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-gray-800">
      <div class="text-center mb-8">
        <div class="bg-gradient-to-r from-purple-500 to-pink-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg class="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
        </div>
      </div>
      <form method="POST" action="/Acceso" class="space-y-5">
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">Email</label>
          <input type="email" name="email" required autocomplete="email"
                 class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">Contraseña</label>
          <input type="password" name="password" required autocomplete="current-password"
                 class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all">
        </div>
        <button type="submit"
                class="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-3 rounded-lg hover:from-purple-700 hover:to-pink-700 transform transition-all duration-200 hover:scale-[1.02] shadow-xl">
          Iniciar Sesión
        </button>
      </form>
    </div>
  </div>
</body>
</html>
  `);
};
