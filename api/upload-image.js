// api/upload-image.js
'use strict';

const { put } = require('@vercel/blob');
const fs = require('fs');

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      // Deshabilitar body parsing automático de Vercel
      req.disableBodyParser = true;

      // Leer RAW body como Buffer
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks);

      // Parsear multipart/form-data manualmente
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=([^;]+)/);
      if (!boundaryMatch) {
        return res.status(400).json({ error: 'No multipart boundary found', type: 'PARSE_ERROR' });
      }

      const boundary = boundaryMatch[1];
      const boundaryStr = `--${boundary}`;
      const parts = rawBody.toString('binary').split(boundaryStr);

      let fileData = null;
      let folder = null;

      for (const part of parts) {
        if (part.includes('name="file"') && part.includes('filename=')) {
          // Extraer headers del part
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;

          const headers = part.slice(0, headerEnd);
          const body = part.slice(headerEnd + 4);

          // Extraer filename
          const filenameMatch = headers.match(/filename="([^"]+)"/);
          const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);

          if (filenameMatch) {
            const filename = filenameMatch[1];
            const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : 'image/png';

            // Extraer body del archivo (hasta el siguiente boundary)
            const bodyEnd = body.indexOf(`\r\n--`);
            if (bodyEnd !== -1) {
              const fileBuffer = Buffer.from(body.slice(0, bodyEnd), 'binary');

              if (fileBuffer.length > 0 && fileBuffer.length <= 4 * 1024 * 1024) {
                if (contentType.startsWith('image/')) {
                  fileData = {
                    name: filename,
                    buffer: fileBuffer,
                    contentType,
                    size: fileBuffer.length
                  };
                }
              }
            }
          }
        }

        if (part.includes('name="folder"')) {
          const valueStart = part.indexOf('\r\n\r\n') + 4;
          const valueEnd = part.indexOf('\r\n', valueStart);
          if (valueStart > 3 && valueEnd > valueStart) {
            folder = part.slice(valueStart, valueEnd).toString().trim();
          }
        }
      }

      if (!fileData) {
        return res.status(400).json({ error: 'No image file received', type: 'NO_FILE' });
      }

      if (!folder || !['plantillas', 'Canales'].includes(folder)) {
        return res.status(400).json({ 
          error: 'Invalid folder: use "plantillas" or "Canales"', 
          type: 'INVALID_FOLDER' 
        });
      }

      const originalName = fileData.name;
      const blobName = `${folder}/${originalName}`;

      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return res.status(500).json({ 
          error: 'Vercel Blob token not configured', 
          type: 'CONFIG_ERROR' 
        });
      }

      console.log(`Uploading ${originalName} (${(fileData.size / 1024).toFixed(1)} KB) to ${blobName}`);

      const result = await put(blobName, fileData.buffer, {
        access: 'public',
        contentType: fileData.contentType,
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false
      });

      if (!result || !result.url) {
        throw new Error('No URL returned from Vercel Blob');
      }

      console.log(`✅ Upload successful: ${result.url}`);

      res.status(200).json({
        success: true,
        url: result.url,
        blobName,
        folder,
        filename: originalName,
        size: fileData.size,
        mimetype: fileData.contentType
      });

    } catch (error) {
      console.error('[Upload Error]', error);
      let type = 'UNKNOWN_ERROR';
      let userMessage = 'Upload failed';

      if (error.message.includes('maxFileSize') || error.message.includes('too large')) {
        type = 'FILE_TOO_LARGE';
        userMessage = 'File exceeds 4MB limit';
      } else if (error.message.includes('BLOB_READ_WRITE_TOKEN')) {
        type = 'CONFIG_ERROR';
        userMessage = 'Vercel Blob not configured';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        type = 'NETWORK_ERROR';
        userMessage = 'Network error with Vercel Blob';
      } else if (error.message.includes('permission') || error.message.includes('access')) {
        type = 'PERMISSION_ERROR';
        userMessage = 'Permission denied';
      } else if (error.message.includes('quota') || error.message.includes('limit')) {
        type = 'QUOTA_ERROR';
        userMessage = 'Storage quota exceeded';
      }

      res.status(500).json({
        error: userMessage,
        type,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    return;
  }

  // GET: Página HTML (tu UI original)
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Subir Imagen a Vercel Blob</title>
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
        .upload-area {
          background: #1a1a1a;
          padding: 2rem;
          border-radius: 8px;
          border: 2px dashed #333;
          margin-bottom: 1rem;
          cursor: pointer;
          transition: border-color 0.3s;
        }
        .upload-area:hover { border-color: #0070f3; }
        .upload-area.dragover { border-color: #0070f3; background: #222; }
        input[type="file"] { display: none; }
        select {
          width: 100%;
          max-width: 400px;
          padding: 0.7rem;
          margin: 0.5rem 0;
          border-radius: 6px;
          border: 1px solid #333;
          background: #222;
          color: #fff;
          font-size: 1rem;
          box-sizing: border-box;
        }
        button {
          background: #0070f3;
          color: white;
          border: none;
          padding: 0.8rem 1.5rem;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1rem;
          margin: 0.5rem;
          transition: background 0.2s;
        }
        button:hover:not(:disabled) { background: #0059c9; }
        button:disabled { background: #666; cursor: not-allowed; }
        #result {
          margin-top: 1.5rem;
          padding: 1rem;
          border-radius: 8px;
          text-align: left;
          display: none;
        }
        .success { background: #1a4f1a; border: 1px solid #2d7a2d; }
        .error { background: #4f1a1a; border: 1px solid #7a2d2d; }
        .url-box {
          background: #222;
          padding: 1rem;
          border-radius: 6px;
          margin: 1rem 0;
          word-break: break-all;
          font-family: monospace;
        }
        img.preview {
          max-width: 300px;
          max-height: 400px;
          border-radius: 6px;
          margin-top: 1rem;
        }
        .file-info { font-size: 0.9rem; color: #aaa; margin-top: 0.5rem; }
        .folder-selector { margin-bottom: 1rem; }
        label { display: block; margin-bottom: 0.5rem; font-weight: bold; }
        .progress { width: 100%; height: 20px; background: #333; border-radius: 10px; overflow: hidden; margin: 1rem 0; }
        .progress-bar { height: 100%; background: #0070f3; width: 0%; transition: width 0.3s; }
        .warning { color: #ffaa00; font-size: 0.9rem; margin-top: 0.5rem; }
      </style>
    </head>
    <body>
      <h1>🖼️ Subir Imagen a Vercel Blob</h1>
      <p><strong>Máximo 4MB por imagen (límite de Vercel)</strong></p>
      <p>Selecciona carpeta y arrastra o selecciona una imagen para subir</p>
      
      <div class="folder-selector">
        <label>Carpeta destino:</label>
        <select id="folder">
          <option value="plantillas">📋 Plantillas</option>
          <option value="Canales">📺 Canales</option>
        </select>
      </div>
      
      <div class="upload-area" id="uploadArea">
        <p>📁 Arrastra una imagen aquí o <span id="clickToUpload">haz clic para seleccionar</span></p>
        <div id="fileInfo" class="file-info" style="display: none;"></div>
        <input type="file" id="fileInput" accept="image/*" />
      </div>
      
      <button id="uploadBtn" disabled>🚀 Subir Imagen</button>
      <div class="progress" id="progress" style="display: none;">
        <div class="progress-bar" id="progressBar"></div>
      </div>
      <div id="result"></div>
      <div class="warning">⚠️ Archivos mayores a 4MB serán rechazados</div>

      <script>
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const uploadBtn = document.getElementById('uploadBtn');
        const folderSelect = document.getElementById('folder');
        const resultDiv = document.getElementById('result');
        const progressDiv = document.getElementById('progress');
        const progressBar = document.getElementById('progressBar');
        const clickToUpload = document.getElementById('clickToUpload');
        let currentFile = null;

        const MAX_SIZE = 4 * 1024 * 1024; // 4MB

        uploadArea.addEventListener('click', () => fileInput.click());
        clickToUpload.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
          uploadArea.addEventListener(eventName, preventDefaults, false);
        });
        
        function preventDefaults(e) {
          e.preventDefault();
          e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
          uploadArea.addEventListener(eventName, highlight, false);
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
          uploadArea.addEventListener(eventName, unhighlight, false);
        });

        function highlight(e) {
          uploadArea.classList.add('dragover');
        }

        function unhighlight(e) {
          uploadArea.classList.remove('dragover');
        }

        fileInput.addEventListener('change', handleFileSelect);
        uploadArea.addEventListener('drop', handleDrop);

        function handleFileSelect(e) {
          handleFiles(e.target.files);
        }

        function handleDrop(e) {
          handleFiles(e.dataTransfer.files);
        }

        function handleFiles(files) {
          if (files.length > 0) {
            currentFile = files[0];
            
            if (currentFile.size > MAX_SIZE) {
              showResult('error', '<h3>❌ Archivo demasiado grande</h3><p>Máximo 4MB permitido. Tu archivo tiene ' + (currentFile.size / 1024 / 1024).toFixed(1) + 'MB</p>');
              return;
            }
            
            const fileInfo = document.getElementById('fileInfo');
            fileInfo.innerHTML = \`
              <strong>\${currentFile.name}</strong><br>
              \${(currentFile.size / 1024).toFixed(1)} KB - \${currentFile.type}
            \`;
            fileInfo.style.display = 'block';
            uploadBtn.disabled = false;
          }
        }

        uploadBtn.addEventListener('click', uploadFile);

        async function uploadFile() {
          if (!currentFile) return;
          
          uploadBtn.disabled = true;
          uploadBtn.textContent = '⏳ Subiendo...';
          progressDiv.style.display = 'block';
          resultDiv.style.display = 'none';
          
          const formData = new FormData();
          formData.append('file', currentFile);
          formData.append('folder', folderSelect.value);
          
          try {
            const response = await fetch('/upload-image', {
              method: 'POST',
              body: formData
            });
            
            const updateProgress = (percent) => {
              progressBar.style.width = percent + '%';
            };
            let progressInterval = setInterval(() => {
              updateProgress(Math.min(95, parseInt(progressBar.style.width) + 5));
            }, 200);
            
            const data = await response.json();
            clearInterval(progressInterval);
            updateProgress(100);
            
            if (response.ok && data.success) {
              showResult('success', \`
                <h3>✅ Subida exitosa</h3>
                <p><strong>Carpeta:</strong> \${data.folder}</p>
                <p><strong>Archivo:</strong> \${data.filename}</p>
                <p><strong>Tamaño:</strong> \${(data.size / 1024).toFixed(1)} KB</p>
                <div class="url-box">
                  <strong>URL:</strong><br>
                  <a href="\${data.url}" target="_blank">\${data.url}</a>
                </div>
                <img src="\${data.url}" alt="Preview" class="preview" onload="this.style.display='block'" style="display:none;">
              \`);
            } else {
              showResult('error', \`
                <h3>❌ Error: \${data.error}</h3>
                <p><strong>Tipo:</strong> \${data.type || 'UNKNOWN'}</p>
                \${data.details ? '<p><strong>Detalles:</strong> ' + data.details + '</p>' : ''}
                <p><strong>Archivo:</strong> \${data.filename || currentFile.name}</p>
                <p><strong>Carpeta:</strong> \${data.folder || folderSelect.value}</p>
              \`);
            }
          } catch (err) {
            clearInterval(progressInterval);
            showResult('error', '<h3>❌ Error de red</h3><p>' + err.message + '</p>');
          } finally {
            setTimeout(() => {
              progressDiv.style.display = 'none';
              uploadBtn.disabled = false;
              uploadBtn.textContent = '🚀 Subir Imagen';
            }, 1000);
          }
        }

        function showResult(type, html) {
          resultDiv.className = type;
          resultDiv.innerHTML = html;
          resultDiv.style.display = 'block';
          progressDiv.style.display = 'none';
        }
      </script>
    </body>
    </html>
  `);
};
