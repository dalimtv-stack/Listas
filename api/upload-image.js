// api/upload-image.js
'use strict';

const { put } = require('@vercel/blob');
const formidable = require('formidable');
const fs = require('fs').promises;
const fetch = require('node-fetch');
const { uploadImageBlob } = require('../lib/upload-to-blob');
const { uploadImageCloudinary } = require('../lib/upload-to-cloudinary');

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    req.disableBodyParser = true;
    
    const form = formidable({
      maxFileSize: 4 * 1024 * 1024,
      keepExtensions: true,
      multiples: false,
      filter: ({ mimetype }) => mimetype?.startsWith('image/') ?? false,
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('❌ Formidable error:', err);
        res.status(500).json({ error: err.message, type: 'PARSE_ERROR' });
        return;
      }

      console.log('✅ Parseado v2:', Object.keys(fields), Object.keys(files));
      console.log('🔍 Fields:', fields);
      console.log('🔍 Files:', files);

      const folder = fields.folder; // v2: string directo
      const target = fields.target || 'cloudinary';
      const customName = fields.customName || null;
      const urlSource = fields.urlSource || null;
      const file = files.file; // v2: objeto File
      
      console.log('📁 Folder recibido:', folder);
      console.log('🎯 Target recibido:', target);
      console.log('📝 Custom name:', customName);
      console.log('🌐 URL source:', urlSource);
      console.log('📄 File recibido:', file?.originalFilename);

      if (!file && !urlSource) {
        res.status(400).json({ error: 'No file or URL provided', type: 'NO_SOURCE' });
        return;
      }

      if (!folder || !['plantillas', 'Canales'].includes(folder)) {
        console.error('❌ Invalid folder:', folder);
        res.status(400).json({ 
          error: `Invalid folder: "${folder}"`, 
          type: 'INVALID_FOLDER',
          received: folder 
        });
        return;
      }

      if (!['cloudinary', 'blob'].includes(target)) {
        console.error('❌ Invalid target:', target);
        res.status(400).json({ 
          error: `Invalid target: "${target}". Use "cloudinary" or "blob"`, 
          type: 'INVALID_TARGET' 
        });
        return;
      }

      let originalName;
      let buffer;

      if (file) {
        // Subida desde archivo
        originalName = customName || file.originalFilename || `${Date.now()}.png`;
        buffer = await fs.readFile(file.filepath);
        // Cleanup temporal
        fs.unlink(file.filepath).catch(console.warn);
      } else {
        // Subida desde URL
        console.log('📥 Fetching URL:', urlSource);
        const response = await fetch(urlSource);
        if (!response.ok) {
          console.error('❌ Fetch failed:', response.status);
          res.status(400).json({ error: `Failed to fetch URL: ${response.status}`, type: 'URL_FETCH_ERROR' });
          return;
        }
        originalName = customName || urlSource.split('/').pop() || `${Date.now()}.jpg`;
        buffer = await response.buffer();
      }

      console.log(`📊 Buffer: ${(buffer.length / 1024).toFixed(1)} KB`);

      let result;
      try {
        if (target === 'cloudinary') {
          if (!process.env.CLOUDINARY_CLOUD_NAME) {
            throw new Error('Cloudinary not configured');
          }
          result = await uploadImageCloudinary(buffer, originalName, folder);
          console.log('☁️ Cloudinary upload OK');
        } else {
          if (!process.env.BLOB_READ_WRITE_TOKEN) {
            throw new Error('BLOB_READ_WRITE_TOKEN missing');
          }
          result = await uploadImageBlob(buffer, originalName, folder);
          console.log('📦 Vercel Blob upload OK');
        }

        res.json({
          success: true,
          url: result.url, // Transformada
          originalUrl: result.originalUrl, // Original
          target,
          folder,
          filename: originalName,
          size: result.size || buffer.length,
          ...(result.public_id && { public_id: result.public_id }),
          ...(result.width && { width: result.width, height: result.height }),
          source: file ? 'file' : 'url'
        });
      } catch (uploadError) {
        console.error('Upload error:', uploadError);
        res.status(500).json({ error: uploadError.message, type: 'UPLOAD_ERROR', target });
      }
    });
    return;
  }

  // HTML con orden solicitado
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Subir Imagen - Cloudinary/Blob</title>
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
        <label>Destino de subida:</label>
        <select id="target">
          <option value="cloudinary" selected>☁️ Cloudinary (Optimizado - Recomendado)</option>
          <option value="blob">📦 Vercel Blob (Legacy)</option>
        </select>
      </div>
      
      <div class="folder-selector">
        <label>Carpeta destino:</label>
        <select id="folder">
          <option value="plantillas">📋 Plantillas</option>
          <option value="Canales">📺 Canales</option>
        </select>
      </div>
      
      <div class="folder-selector">
        <label>Origen:</label>
        <select id="source">
          <option value="file" selected>📁 Archivo</option>
          <option value="url">🌐 URL</option>
        </select>
      </div>
      
      <div class="upload-area" id="uploadArea">
        <p>📁 Arrastra una imagen aquí o <span id="clickToUpload">haz clic para seleccionar</span></p>
        <div id="fileInfo" class="file-info" style="display: none;"></div>
        <input type="file" id="fileInput" accept="image/*" />
      </div>
      
      <div id="urlSection" style="display: none;">
        <input type="text" id="urlInput" placeholder="https://ejemplo.com/imagen.jpg" />
        <button onclick="validateUrl()">Verificar</button>
      </div>
      
      <div id="renameSection" class="rename-section">
        <label>Nombre personalizado:</label>
        <input type="text" id="customName" placeholder="NombreParaLaImagen.jpg" />
        <small>Deja vacío para usar nombre original</small>
      </div>
      
      <button id="renameBtn" class="rename-btn" onclick="toggleRename()">✏️ Renombrar imagen</button>
      <button id="uploadBtn" disabled>🚀 Subir Imagen</button>
      
      <div class="progress" id="progress" style="display: none;">
        <div class="progress-bar" id="progressBar"></div>
      </div>
      <div id="result"></div>
      <div class="warning">⚠️ Archivos mayores a 4MB serán rechazados</div>

      <script>
        // TU JS ORIGINAL + FIXES
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const uploadBtn = document.getElementById('uploadBtn');
        const folderSelect = document.getElementById('folder');
        const targetSelect = document.getElementById('target');
        const sourceSelect = document.getElementById('source');
        const urlSection = document.getElementById('urlSection');
        const urlInput = document.getElementById('urlInput');
        const renameSection = document.getElementById('renameSection');
        const renameBtn = document.getElementById('renameBtn');
        const customName = document.getElementById('customName');
        const resultDiv = document.getElementById('result');
        const progressDiv = document.getElementById('progress');
        const progressBar = document.getElementById('progressBar');
        let currentFile = null;
        let currentUrl = null;

        const MAX_SIZE = 4 * 1024 * 1024; // 4MB

        // Switch source
        sourceSelect.addEventListener('change', () => {
          const source = sourceSelect.value;
          uploadArea.style.display = source === 'file' ? 'block' : 'none';
          urlSection.style.display = source === 'url' ? 'block' : 'none';
          resetUpload();
        });

        function toggleRename() {
          renameSection.style.display = renameSection.style.display === 'none' ? 'block' : 'none';
        }

        function validateUrl() {
          const url = urlInput.value.trim();
          if (!url) return;

          // Simula validación (backend hace el real fetch)
          uploadBtn.disabled = false;
          currentUrl = url;
          currentFile = null;
          document.getElementById('fileInfo').style.display = 'none';
        }

        // Drag & Drop y click original
        uploadArea.addEventListener('click', () => fileInput.click());

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
            currentUrl = null;
          }
        }

        uploadBtn.addEventListener('click', uploadFile);

        async function uploadFile() {
          if (!currentFile && !currentUrl) return;
          
          uploadBtn.disabled = true;
          uploadBtn.textContent = '⏳ Subiendo...';
          progressDiv.style.display = 'block';
          resultDiv.style.display = 'none';
          
          const formData = new FormData();
          formData.append('folder', folderSelect.value);
          formData.append('target', targetSelect.value);
          const customNameValue = customName.value.trim();
          if (customNameValue) formData.append('customName', customNameValue);
          
          if (currentFile) {
            formData.append('file', currentFile);
          } else {
            formData.append('urlSource', currentUrl);
          }
          
          let progressInterval;
          try {
            const response = await fetch('/upload-image', {
              method: 'POST',
              body: formData
            });
            
            const updateProgress = (percent) => {
              progressBar.style.width = percent + '%';
            };
            progressInterval = setInterval(() => {
              updateProgress(Math.min(95, parseInt(progressBar.style.width) + 5));
            }, 200);
            
            const data = await response.json();
            clearInterval(progressInterval);
            updateProgress(100);
            
            if (response.ok && data.success) {
              showResult('success', \`
                <h3>✅ Subida exitosa a \${data.target === 'cloudinary' ? '☁️ Cloudinary' : '📦 Vercel Blob'}</h3>
                <p><strong>Original URL:</strong> <a href="\${data.originalUrl}" target="_blank">\${data.originalUrl}</a></p>
                <p><strong>Transformada URL:</strong> <a href="\${data.url}" target="_blank">\${data.url}</a></p>
                <p><strong>Carpeta:</strong> \${data.folder}</p>
                <p><strong>Archivo:</strong> \${data.filename}</p>
                <p><strong>Tamaño:</strong> \${(data.size / 1024).toFixed(1)} KB</p>
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
            if (progressInterval) clearInterval(progressInterval);
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
