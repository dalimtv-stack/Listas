// api/upload-image.js
'use strict';

const { put } = require('@vercel/blob');
const formidable = require('formidable');
const fs = require('fs');

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    let fields, files;
    const uploadedFilepaths = [];
    const form = formidable({
      maxFileSize: 4 * 1024 * 1024, // 4MB safe limit (under Vercel's 4.5MB)
      keepExtensions: true,
      multiples: false,
      filter: ({ mimetype }) => mimetype?.startsWith('image/') ?? false,
    });

    try {
      [fields, files] = await form.parse(req);
      const file = files.file?.[0];
      if (Array.isArray(files.file)) uploadedFilepaths.push(...files.file.map(f => f.filepath));
      else if (file) uploadedFilepaths.push(file.filepath);

      const folder = fields.folder?.[0];
      if (!file) {
        return res.status(400).json({ error: 'No image file received', type: 'NO_FILE' });
      }
      if (!folder || !['plantillas', 'Canales'].includes(folder)) {
        return res.status(400).json({ error: 'Invalid folder: use "plantillas" or "Canales"', type: 'INVALID_FOLDER' });
      }

      const originalName = file.originalFilename || `${Date.now()}.png`;
      const blobName = `${folder}/${originalName}`;

      const buffer = await fs.promises.readFile(file.filepath);
      if (buffer.length === 0) {
        throw new Error('Empty file');
      }

      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        throw new Error('BLOB_READ_WRITE_TOKEN missing');
      }

      console.log(`Uploading ${originalName} (${(buffer.length / 1024).toFixed(1)} KB) to ${blobName}`);

      const result = await put(blobName, buffer, {
        access: 'public',
        contentType: file.mimetype || 'image/png',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false, // Keep original name
      });

      if (!result.url) {
        throw new Error('No URL returned from Blob');
      }

      res.setHeader('Content-Type', 'application/json');
      res.json({
        success: true,
        url: result.url,
        blobName,
        folder,
        filename: originalName,
        size: buffer.length,
      });

    } catch (error) {
      console.error('[Upload Error]', error.message);
      let type = 'UNKNOWN_ERROR';
      let userMessage = error.message;

      if (error.message.includes('maxFileSize') || error.message.includes('File too large')) {
        type = 'FILE_TOO_LARGE';
        userMessage = 'File exceeds 4MB limit (Vercel Functions restriction)';
      } else if (error.message.includes('BLOB_READ_WRITE_TOKEN')) {
        type = 'CONFIG_ERROR';
        userMessage = 'Vercel Blob token not configured';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        type = 'NETWORK_ERROR';
      } else if (error.message.includes('permission') || error.message.includes('access denied')) {
        type = 'PERMISSION_ERROR';
      } else if (error.message.includes('quota') || error.message.includes('limit')) {
        type = 'QUOTA_ERROR';
      }

      res.status(500).setHeader('Content-Type', 'application/json');
      res.json({
        error: userMessage,
        type,
        filename: files?.file?.[0]?.originalFilename,
        folder: fields?.folder?.[0],
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    } finally {
      uploadedFilepaths.forEach((filepath) => {
        fs.unlink(filepath, (err) => {
          if (err) console.warn('[Cleanup Warn]', filepath, err.message);
        });
      });
    }
    return;
  }

  // Página HTML principal
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
      <div class="warning">⚠️ Archivos mayores a 10MB serán rechazados</div>

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

        // Click para seleccionar archivo
        uploadArea.addEventListener('click', () => fileInput.click());
        clickToUpload.addEventListener('click', () => fileInput.click());

        // Drag & Drop
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
            
            // Validar tamaño
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
            
            // Actualizar progreso (simulado)
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
