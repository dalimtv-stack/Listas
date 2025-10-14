// api/resolution.js
'use strict';

const fetch = require('node-fetch');

module.exports = async (req, res) => {
  if (req.method === 'GET' && req.query.url) {
    const { url } = req.query;
    if (!url || !/^https?:\/\//.test(url) || !url.endsWith('.m3u8')) {
      return res.status(400).json({ error: 'Invalid .m3u8 URL' });
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      const text = await response.text();

      const results = [];
      const regex = /#EXT-X-STREAM-INF:.*?BANDWIDTH=(\d+)(?:.*?RESOLUTION=(\d+)x(\d+))?(?:.*?CODECS="([^"]+)")?/g;

      // Handle master playlist
      if (text.includes('#EXT-X-STREAM-INF')) {
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
            const variantUrl = lines[i + 1];
            if (variantUrl && !variantUrl.startsWith('#')) {
              const absoluteUrl = new URL(variantUrl, url).href;
              const variantResponse = await fetch(absoluteUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
              });
              const variantText = await variantResponse.text();
              let match;
              while ((match = regex.exec(variantText)) !== null) {
                results.push({
                  label: `${match[3] || 'unknown'}p`,
                  width: parseInt(match[2]) || null,
                  height: parseInt(match[3]) || null,
                  bandwidth: parseInt(match[1]),
                  codecs: match[4] || null,
                });
              }
            }
          }
        }
      } else {
        // Handle media playlist
        let match;
        while ((match = regex.exec(text)) !== null) {
          results.push({
            label: `${match[3] || 'unknown'}p`,
            width: parseInt(match[2]) || null,
            height: parseInt(match[3]) || null,
            bandwidth: parseInt(match[1]),
            codecs: match[4] || null,
          });
        }
      }

      const unique = [...new Map(results.map(r => [r.label, r])).values()];

      if (!unique.length) {
        return res.json({
          resolutions: [{ label: 'No resolutions detected', width: null, height: null }],
        });
      }

      return res.json({ resolutions: unique });
    } catch (err) {
      console.error('Error:', err);
      return res.status(500).json({ error: err.message });
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
          if (!url) {
            resultDiv.textContent = '❌ Introduce una URL válida';
            return;
          }
          resultDiv.textContent = 'Analizando...';
          try {
            const res = await fetch(\`/api/resolution?url=\${encodeURIComponent(url)}\`);
            const text = await res.text();
            let data;
            try {
              data = JSON.parse(text);
            } catch {
              throw new Error('Respuesta no válida: ' + text.slice(0, 80));
            }

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
