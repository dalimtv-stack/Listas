// api/resolution.js
'use strict';

const fetch = require('node-fetch');

module.exports = async (req, res) => {
  if (req.method === 'GET' && req.query.url) {
    let { url } = req.query;
    if (!url || !url.startsWith('http')) {
      console.error('URL inválida:', url);
      return res.status(400).json({ error: 'URL inválida, debe empezar con http o https', content: null, redirects: [url] });
    }

    try {
      console.log('Solicitando URL inicial:', url);
      // Capturar redirecciones
      const redirects = [url];
      const customFetch = async (fetchUrl) => {
        const response = await fetch(fetchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          redirect: 'manual',
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (location) {
            const nextUrl = new URL(location, fetchUrl).href;
            console.log('Redirección detectada:', nextUrl);
            redirects.push(nextUrl);
            return await customFetch(nextUrl);
          }
        }
        return response;
      };

      let response = await customFetch(url);
      if (!response.ok) {
        console.error('Error HTTP:', response.status, response.statusText);
        throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
      }

      // Obtener la URL final
      let finalUrl = redirects[redirects.length - 1];
      console.log('URL final:', finalUrl);

      // Verificar tipo MIME para evitar leer contenido binario
      const contentType = response.headers.get('content-type') || '';
      let text = null;
      if (contentType.includes('text') || contentType.includes('application/vnd.apple.mpegurl')) {
        text = await response.text();
        console.log('Contenido recibido (primeros 5000 chars):', text.slice(0, 5000));
      } else {
        console.log('Contenido no es texto (tipo MIME:', contentType, '), omitiendo lectura');
        text = '[Contenido no legible, probablemente archivo binario (.ts)]';
      }

      // Si la URL final no termina en .m3u8, intentar extraer una URL .m3u8 del contenido
      if (!finalUrl.endsWith('.m3u8')) {
        console.log('No es un archivo .m3u8, buscando URL .m3u8 en el contenido');
        if (text && text !== '[Contenido no legible, probablemente archivo binario (.ts)]') {
          const m3u8Regex = /(https?:\/\/[^\s"']+\.m3u8)/i;
          const match = text.match(m3u8Regex);
          if (match) {
            url = match[1];
            console.log('URL .m3u8 encontrada:', url);
            redirects.push(url);
            response = await fetch(url, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
            });
            if (!response.ok) {
              console.error('Error HTTP al obtener .m3u8:', response.status, response.statusText);
              throw new Error(`Error HTTP al obtener .m3u8: ${response.status}`);
            }
            finalUrl = url;
            const newContentType = response.headers.get('content-type') || '';
            if (newContentType.includes('text') || newContentType.includes('application/vnd.apple.mpegurl')) {
              text = await response.text();
              console.log('Contenido recibido (primeros 5000 chars):', text.slice(0, 5000));
            } else {
              text = '[Contenido no legible, probablemente archivo binario (.ts)]';
            }
          } else {
            console.error('No se encontró una URL .m3u8 en el contenido');
            return res.json({
              error: 'No se encontró un archivo .m3u8 en la URL proporcionada',
              content: text.slice(0, 5000),
              redirects,
            });
          }
        } else {
          console.error('No se encontró una URL .m3u8 y el contenido no es legible');
          return res.json({
            error: 'No se encontró un archivo .m3u8 en la URL proporcionada',
            content: text,
            redirects,
          });
        }
      }

      const results = [];
      const lines = text.split('\n');
      const regex = /#EXT-X-STREAM-INF:(.*)/g;
      const attrRegex = /BANDWIDTH=(\d+)|RESOLUTION=(\d+)x(\d+)|CODECS="([^"]+)"/g;

      if (text.includes('#EXT-X-STREAM-INF')) {
        console.log('Detectado master playlist - parseando directamente');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
            const attributes = lines[i].replace('#EXT-X-STREAM-INF:', '');
            console.log('Línea #EXT-X-STREAM-INF:', attributes);
            let bandwidth, width, height, codecs;

            let attrMatch;
            attrRegex.lastIndex = 0;
            while ((attrMatch = attrRegex.exec(attributes)) !== null) {
              if (attrMatch[1]) bandwidth = parseInt(attrMatch[1]);
              if (attrMatch[2] && attrMatch[3]) {
                width = parseInt(attrMatch[2]);
                height = parseInt(attrMatch[3]);
              }
              if (attrMatch[4]) codecs = attrMatch[4];
            }

            let variantUrl = null;
            if (i + 1 < lines.length && !lines[i + 1].startsWith('#') && lines[i + 1].trim()) {
              try {
                variantUrl = new URL(lines[i + 1], finalUrl).href;
              } catch (e) {
                console.warn('No se pudo resolver la URL variante:', lines[i + 1], e.message);
              }
            }

            if (bandwidth) {
              results.push({
                label: `${height || 'desconocido'}p`,
                width: width || null,
                height: height || null,
                bandwidth,
                codecs: codecs || null,
                url: variantUrl,
              });
            }
          }
        }
      } else {
        console.log('Detectado media playlist - parseando');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
            const attributes = lines[i].replace('#EXT-X-STREAM-INF:', '');
            console.log('Línea #EXT-X-STREAM-INF:', attributes);
            let bandwidth, width, height, codecs;

            let attrMatch;
            attrRegex.lastIndex = 0;
            while ((attrMatch = attrRegex.exec(attributes)) !== null) {
              if (attrMatch[1]) bandwidth = parseInt(attrMatch[1]);
              if (attrMatch[2] && attrMatch[3]) {
                width = parseInt(attrMatch[2]);
                height = parseInt(attrMatch[3]);
              }
              if (attrMatch[4]) codecs = attrMatch[4];
            }

            if (bandwidth) {
              results.push({
                label: `${height || 'desconocido'}p`,
                width: width || null,
                height: height || null,
                bandwidth,
                codecs: codecs || null,
                url: null,
              });
            }
          }
        }
      }

      const unique = [...new Map(results.map(r => [r.label, r])).values()];

      if (!unique.length) {
        console.log('No se detectaron resoluciones');
        return res.json({
          resolutions: [{ label: 'No se detectaron resoluciones', width: null, height: null, bandwidth: null, codecs: null, url: null }],
          content: text.slice(0, 5000),
          redirects,
        });
      }

      console.log('Resoluciones encontradas:', unique);
      return res.json({ resolutions: unique, content: null, redirects });
    } catch (err) {
      console.error('Error en servidor:', err.message);
      return res.status(500).json({ error: `Error: ${err.message}`, content: null, redirects });
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
          max-width: 900px;
          margin: 2rem auto;
          padding: 1rem;
          text-align: center;
        }
        input {
          width: 100%;
          max-width: 700px;
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
          transition: background 0.2s;
        }
        button:hover { background: #0059c9; }
        #result {
          margin-top: 1.5rem;
          background: #1a1a1a;
          padding: 1rem;
          border-radius: 8px;
          text-align: left;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 1rem;
        }
        th, td {
          padding: 0.8rem;
          border: 1px solid #333;
          text-align: left;
          font-size: 0.9rem;
        }
        th {
          background: #222;
          font-weight: bold;
        }
        td {
          background: #1a1a1a;
        }
        a {
          color: #0070f3;
          text-decoration: none;
          word-break: break-all;
        }
        a:hover {
          text-decoration: underline;
        }
        .error {
          color: #ff4444;
          font-weight: bold;
        }
        pre {
          background: #222;
          padding: 1rem;
          border-radius: 6px;
          margin-top: 1rem;
          white-space: pre-wrap;
          word-break: break-all;
          font-size: 0.85rem;
          color: #ccc;
        }
        @media (max-width: 600px) {
          table, th, td, pre {
            font-size: 0.8rem;
            padding: 0.5rem;
          }
        }
      </style>
    </head>
    <body>
      <h1>M3U8 Resolution Checker</h1>
      <p>Introduce la URL del stream (.m3u8 o enlace HLS):</p>
      <input type="text" id="streamUrl" placeholder="https://example.com/playlist.m3u8 o /play/a02c" />
      <button onclick="checkResolution()">Analizar resolución</button>
      <div id="result"></div>

      <script>
        async function checkResolution() {
          const url = document.getElementById('streamUrl').value.trim();
          const resultDiv = document.getElementById('result');
          if (!url || !url.startsWith('http')) {
            resultDiv.innerHTML = '<p class="error">❌ Introduce una URL válida que empiece con http o https</p>';
            return;
          }
          resultDiv.innerHTML = '<p>Analizando...</p>';
          try {
            const res = await fetch(\`/Resolution?url=\${encodeURIComponent(url)}\`);
            if (!res.ok) {
              const text = await res.text();
              resultDiv.innerHTML = \`<p class="error">Error del servidor: HTTP \${res.status} - \${text.slice(0, 80)}</p>\`;
              return; // No lanzar error para evitar sobrescribir
            }
            const data = await res.json();
            let errorHtml = '';
            if (data.error) {
              errorHtml = \`<p class="error">❌ \${data.error}</p>\`;
              if (data.content) {
                errorHtml += \`<pre>Contenido del archivo (primeros 5000 caracteres):\n\${data.content}</pre>\`;
              }
              if (data.redirects && data.redirects.length > 1) {
                errorHtml += \`<pre>Cadena de redirecciones:\n\${data.redirects.join(' → ')}</pre>\`;
              }
              resultDiv.innerHTML = errorHtml;
              return;
            }

            if (data.resolutions[0].label === 'No se detectaron resoluciones') {
              errorHtml = '<p class="error">❌ No se detectaron resoluciones</p>';
              if (data.content) {
                errorHtml += \`<pre>Contenido del archivo (primeros 5000 caracteres):\n\${data.content}</pre>\`;
              }
              if (data.redirects && data.redirects.length > 1) {
                errorHtml += \`<pre>Cadena de redirecciones:\n\${data.redirects.join(' → ')}</pre>\`;
              }
              resultDiv.innerHTML = errorHtml;
              return;
            }

            let table = '<table><tr><th>Resolución</th><th>Ancho</th><th>Alto</th><th>Bitrate</th><th>Codecs</th><th>URL</th></tr>';
            data.resolutions.forEach(r => {
              table += \`<tr>
                <td>\${r.label}</td>
                <td>\${r.width || '-'}</td>
                <td>\${r.height || '-'}</td>
                <td>\${r.bandwidth ? (r.bandwidth / 1000).toFixed(0) + ' kbps' : '-'}</td>
                <td>\${r.codecs || '-'}</td>
                <td>\${r.url ? \`<a href="\${r.url}" target="_blank">Ver</a>\` : '-'}</td>
              </tr>\`;
            });
            table += '</table>';
            if (data.redirects && data.redirects.length > 1) {
              table += \`<pre>Cadena de redirecciones:\n\${data.redirects.join(' → ')}</pre>\`;
            }
            resultDiv.innerHTML = table;
          } catch (err) {
            let errorHtml = \`<p class="error">❌ Error: \${err.message}</p>\`;
            resultDiv.innerHTML = errorHtml;
          }
        }
      </script>
    </body>
    </html>
  `);
};
