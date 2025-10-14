// api/resolution.js
'use strict';

const fetch = require('node-fetch');

module.exports = async (req, res) => {
  if (req.method === 'GET' && req.query.url) {
    const { url } = req.query;
    if (!url || !url.startsWith('http') || !url.endsWith('.m3u8')) {
      console.error('URL inválida:', url);
      return res.status(400).json({ error: 'URL inválida, debe ser un .m3u8' });
    }

    try {
      console.log('Solicitando URL:', url);
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!response.ok) {
        console.error('Error HTTP:', response.status, response.statusText);
        throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
      }
      const text = await response.text();
      console.log('Contenido recibido (primeros 200 chars):', text.slice(0, 200));

      const results = [];
      // Regex más flexible para capturar BANDWIDTH, RESOLUTION y CODECS en cualquier orden
      const regex = /#EXT-X-STREAM-INF:(?:.*?)BANDWIDTH=(\d+)(?:.*?)RESOLUTION=(\d+)x(\d+)(?:.*?)CODECS="([^"]+)"?/g;

      if (text.includes('#EXT-X-STREAM-INF')) {
        console.log('Detectado master playlist - parseando directamente');
        let match;
        while ((match = regex.exec(text)) !== null) {
          results.push({
            label: `${match[3] || 'desconocido'}p`,
            width: parseInt(match[2]) || null,
            height: parseInt(match[3]) || null,
            bandwidth: parseInt(match[1]),
            codecs: match[4] || null,
          });
        }
      } else {
        console.log('Detectado media playlist - parseando');
        let match;
        while ((match = regex.exec(text)) !== null) {
          results.push({
            label: `${match[3] || 'desconocido'}p`,
            width: parseInt(match[2]) || null,
            height: parseInt(match[3]) || null,
            bandwidth: parseInt(match[1]),
            codecs: match[4] || null,
          });
        }
      }

      // Eliminar duplicados basados en label
      const unique = [...new Map(results.map(r => [r.label, r])).values()];

      if (!unique.length) {
        console.log('No se detectaron resoluciones');
        return res.json({
          resolutions: [{ label: 'No se detectaron resoluciones', width: null, height: null }],
        });
      }

      console.log('Resoluciones encontradas:', unique);
      return res.json({ resolutions: unique });
    } catch (err) {
      console.error('Error en servidor:', err.message);
      return res.status(500).json({ error: `Error: ${err.message}` });
    }
  }

  // Página HTML principal
  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>M3U8 Resolution Checker</title>
      <style>
        body {
          background-color: #111;
          color: #eee;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          max-width: 700px;
          margin: 2rem auto;
          padding: 1rem;
          text-align: center;
        }
        input {
          width: 100%;
          max-width: 600px;
          padding: 0.7rem;
          margin-bottom: 1rem;
          border-radius: 6px;
          border: 1px solid #333;
          background: #222;
          color: #fff;
          font-size: 1rem;
        }
        button {
          background: #0070f3;
          color: white;
          border: none;
          padding: 0.7rem 1.2rem;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1rem;
        }
        button:hover { background: #0059c9; }
        #result {
          margin-top: 1.5rem;
          background: #1a1a1a;
          padding: 1rem;
          border-radius: 8px;
          text-align: left;
          white-space: pre-line;
          line-height: 1.4;
        }
      </style>
    </head>
    <body>
      <h1>M3U8 Resolution Checker</h1>
      <p>Introduce la URL del stream (.m3u8):</p>
      <input type="text" id="streamUrl" placeholder="https://example.com/playlist.m3u8" />
      <button onclick="checkResolution()">Analizar resolución</button>
      <div id="result"></div>

      <script>
        async function checkResolution() {
          const url = document.getElementById('streamUrl').value.trim();
          const resultDiv = document.getElementById('result');
          if (!url || !url.endsWith('.m3u8')) {
            resultDiv.textContent = '❌ Introduce una URL válida que termine en .m3u8';
            return;
          }
          resultDiv.textContent = 'Analizando...';
          try {
            // CAMBIO CLAVE: Cambia /api/resolution a /Resolution (la misma ruta de la página)
            const res = await fetch(\`/Resolution?url=\${encodeURIComponent(url)}\`);
            if (!res.ok) {
              const text = await res.text();
              throw new Error(\`Error del servidor: HTTP \${res.status} - \${text.slice(0, 80)}\`);
            }
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            resultDiv.innerHTML = data.resolutions
              .map(r => {
                const parts = [
                  \`\${r.label} (\${r.width}x\${r.height})\`,
                  r.bandwidth ? \`BANDWIDTH: \${r.bandwidth}\` : null,
                  r.codecs ? \`CODECS: \${r.codecs}\` : null
                ].filter(Boolean);
                return parts.join(' | ');
              })
              .join('\\n');
          } catch (err) {
            resultDiv.textContent = '❌ Error: ' + err.message;
          }
        }
      </script>
    </body>
    </html>
  `);
};
