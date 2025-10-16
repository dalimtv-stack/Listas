// api/upload-image.js - FIX FORMIDABLE V2 PARSING
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

      // ✅ FIX: Función helper para extraer valores de Formidable v2
      const getFieldValue = (field) => {
        if (!field) return null;
        if (Array.isArray(field)) {
          return field[0] || null; // Primer valor del array
        }
        return field;
      };

      const folder = getFieldValue(fields.folder);
      const target = getFieldValue(fields.target) || 'cloudinary';
      const customName = getFieldValue(fields.customName);
      const urlSource = getFieldValue(fields.urlSource);
      const file = files.file?.[0]; // Files siempre array en v2
      
      console.log('📁 Folder:', folder, '🎯 Target:', target);
      console.log('📝 Custom name:', customName);
      console.log('🌐 URL source:', urlSource);
      console.log('📄 File:', file?.originalFilename);

      if (!file && !urlSource) {
        res.status(400).json({ error: 'No file or URL provided', type: 'NO_SOURCE' });
        return;
      }

      if (!folder || !['plantillas', 'Canales'].includes(folder)) {
        res.status(400).json({ error: `Invalid folder: "${folder}"`, type: 'INVALID_FOLDER' });
        return;
      }

      if (!['cloudinary', 'blob'].includes(target)) {
        res.status(400).json({ error: `Invalid target: "${target}"`, type: 'INVALID_TARGET' });
        return;
      }

      let originalName, buffer;

      if (file) {
        originalName = customName || file.originalFilename || `${Date.now()}.png`;
        buffer = await fs.readFile(file.filepath);
        await fs.unlink(file.filepath).catch(console.warn);
      } else {
        console.log('📥 Fetching URL:', urlSource);
        const response = await fetch(urlSource);
        if (!response.ok) {
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
          result = await uploadImageCloudinary(buffer, originalName, folder);
          console.log('☁️ Cloudinary OK');
        } else {
          result = await uploadImageBlob(buffer, originalName, folder);
          console.log('📦 Blob OK');
        }

        const responseData = {
          success: true,
          url: result.url,
          originalUrl: result.originalUrl || result.url,
          target,
          folder,
          filename: result.filename || originalName,
          size: result.size || buffer.length,
          ...(result.public_id && { public_id: result.public_id }),
          ...(result.width && { width: result.width, height: result.height }),
          source: file ? 'file' : 'url',
          ...(result.formats && { formats: result.formats })
        };

        res.json(responseData);
      } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message, type: 'UPLOAD_ERROR', target });
      }
    });
    return;
  }

  // ✅ HTML CON BACKTICKS CORRECTOS
   res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!DOCTYPE html>
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
        .upload-area, .url-area {
          background: #1a1a1a;
          padding: 2rem;
          border-radius: 8px;
          border: 2px dashed #333;
          margin-bottom: 1rem;
          cursor: pointer;
          transition: border-color 0.3s;
        }
        .upload-area:hover, .url-area:hover { border-color: #0070f3; }
        .upload-area.dragover, .url-area.dragover { border-color: #0070f3; background: #222; }
        input[type="file"], input[type="url"] { 
          display: block; 
          width: 100%; 
          padding: 0.5rem; 
          margin-top: 0.5rem; 
          background: #222; 
          color: #fff; 
          border: 1px solid #333; 
          border-radius: 4px; 
        }
        select, input[type="text"] {
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
        .target-selector {
          background: linear-gradient(90deg, #ff6b6b, #4ecdc4);
          padding: 1rem;
          border-radius: 8px;
          margin: 1rem 0;
        }
        .rename-section {
          display: none;
          margin: 1rem 0;
          padding: 1rem;
          background: #222;
          border-radius: 8px;
          border: 1px solid #333;
        }
        .rename-section.active { display: block; }
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
        .rename-btn { background: #ff9500; margin-right: 1rem; }
        .rename-btn:hover { background: #e68900; }
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
        .file-info, .url-info { font-size: 0.9rem; color: #aaa; margin-top: 0.5rem; }
        .folder-selector, .target-selector { margin-bottom: 1rem; }
        label { display: block; margin-bottom: 0.5rem; font-weight: bold; }
        .progress { width: 100%; height: 20px; background: #333; border-radius: 10px; overflow: hidden; margin: 1rem 0; }
        .progress-bar { height: 100%; background: #0070f3; width: 0%; transition: width 0.3s; }
        .warning { color: #ffaa00; font-size: 0.9rem; margin-top: 0.5rem; }
        .source-tabs { display: flex; justify-content: center; margin: 1rem 0; }
        .source-tab { padding: 0.5rem 1rem; margin: 0 0.5rem; background: #333; border: none; border-radius: 20px; cursor: pointer; }
        .source-tab.active { background: #0070f3; }
        input[type="file"] { display: none; }

        /* ✅ FIX: ESTILOS PARA ENLACES LEGIBLES */
        a { 
          color: #4ecdc4 !important; 
          text-decoration: none; 
        }
        a:hover { 
          color: #66ffcc !important; 
          text-decoration: underline; 
        }
        .url-box a, .format-box a {
          color: #4ecdc4 !important;
          font-family: 'Courier New', monospace;
          font-size: 0.9rem;
          line-height: 1.4;
        }
        .url-box a:hover, .format-box a:hover {
          color: #66ffcc !important;
          background: rgba(78, 205, 196, 0.1);
          padding: 2px 4px;
          border-radius: 3px;
        }

        /* ✅ FIX: MÚLTIPLES PREVIEWS */
        .previews-container {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          justify-content: center;
          margin-top: 1rem;
          padding: 1rem;
          background: #1a1a1a;
          border-radius: 8px;
        }
        .preview, .format-preview {
          max-width: 200px;
          max-height: 300px;
          border-radius: 6px;
          border: 2px solid #333;
          transition: all 0.3s ease;
          box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        }
        .preview:hover, .format-preview:hover {
          border-color: #4ecdc4;
          transform: scale(1.02);
          box-shadow: 0 4px 15px rgba(78, 205, 196, 0.3);
        }
        .format-preview {
          max-width: 150px;
          max-height: 225px;
        }
        .format-box {
          margin: 0.5rem 0;
          padding: 0.75rem;
          background: #1a1a1a;
          border-radius: 6px;
          border-left: 4px solid #4ecdc4;
          text-align: left;
        }
        details {
          margin: 1rem 0;
          background: #222;
          border-radius: 6px;
          border: 1px solid #333;
        }
        summary {
          cursor: pointer;
          padding: 0.75rem;
          background: #333;
          border-radius: 4px;
          font-weight: bold;
          color: #4ecdc4;
        }
        summary:hover { background: #444; }
      </style>
    </head>
    <body>
      <h1>🖼️ Subir Imagen - Cloudinary/Blob</h1>
      <p><strong>Máximo 4MB por imagen</strong></p>
      
      <div class="target-selector">
        <label>Destino de subida:</label>
        <select id="target">
          <option value="cloudinary" selected>☁️ Cloudinary (Optimizado - Recomendado)</option>
          <option value="blob">📦 Vercel Blob (Legacy)</option>
        </select>
      </div>
      
      <div class="folder-selector">
        <label>Carpeta destino:</label>
        <select id="folder">
          <option value="Canales" selected>📺 Canales</option>
          <option value="plantillas">📋 Plantillas</option>
        </select>
      </div>

      <div class="source-tabs">
        <button class="source-tab active" onclick="switchSource('file')">📁 Desde Archivo</button>
        <button class="source-tab" onclick="switchSource('url')">🌐 Desde URL</button>
      </div>

      <div id="fileSource" class="upload-area">
        <p>📁 Arrastra una imagen aquí o <span id="clickToUpload">haz clic para seleccionar</span></p>
        <div id="fileInfo" class="file-info" style="display: none;"></div>
        <input type="file" id="fileInput" accept="image/*" />
      </div>

      <div id="urlSource" class="url-area" style="display: none;">
        <label>URL de la imagen:</label>
        <input type="url" id="urlInput" placeholder="https://ejemplo.com/imagen.jpg" />
        <div id="urlInfo" class="url-info" style="display: none;"></div>
        <button onclick="fetchUrlPreview()">🔍 Verificar URL</button>
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
      <div class="warning">⚠️ Cloudinary optimiza automáticamente (WebP, resize, CDN global)</div>

      <script>
        let currentSource = 'file';
        let currentFile = null;
        let currentUrl = null;
        const MAX_SIZE = 4 * 1024 * 1024;

        function switchSource(source) {
          currentSource = source;
          document.querySelectorAll('.source-tab').forEach(tab => tab.classList.remove('active'));
          event.target.classList.add('active');
          
          document.getElementById('fileSource').style.display = source === 'file' ? 'block' : 'none';
          document.getElementById('urlSource').style.display = source === 'url' ? 'block' : 'none';
          document.getElementById('renameSection').classList.remove('active');
          document.getElementById('renameBtn').textContent = '✏️ Renombrar imagen';
          resetUpload();
        }

        function toggleRename() {
          const section = document.getElementById('renameSection');
          section.classList.toggle('active');
          if (section.classList.contains('active')) {
            document.getElementById('renameBtn').textContent = '❌ Cancelar';
          } else {
            document.getElementById('renameBtn').textContent = '✏️ Renombrar imagen';
          }
        }

        async function fetchUrlPreview() {
          const urlInput = document.getElementById('urlInput');
          const urlInfo = document.getElementById('urlInfo');
          const url = urlInput.value.trim();
          
          if (!url) {
            urlInfo.innerHTML = '<span style="color: #ff6b6b;">❌ Ingresa una URL válida</span>';
            urlInfo.style.display = 'block';
            return;
          }

          try {
            urlInfo.innerHTML = '⏳ Verificando URL...';
            urlInfo.style.display = 'block';
            
            const response = await fetch(url);
            if (!response.ok) throw new Error('URL no accesible');
            
            const contentType = response.headers.get('content-type');
            if (!contentType?.startsWith('image/')) {
              throw new Error('No es una imagen válida');
            }

            const blob = await response.blob();
            if (blob.size > MAX_SIZE) {
              throw new Error('Imagen demasiado grande (>4MB)');
            }

            currentUrl = url;
            urlInfo.innerHTML = \`
              ✅ URL válida<br>
              Tamaño: \${(blob.size / 1024).toFixed(1)} KB<br>
              Tipo: \${contentType}
            \`;
            urlInfo.style.color = '#4ecdc4';
            document.getElementById('uploadBtn').disabled = false;
          } catch (error) {
            urlInfo.innerHTML = \`<span style="color: #ff6b6b;">❌ Error: \${error.message}</span>\`;
            currentUrl = null;
            document.getElementById('uploadBtn').disabled = true;
          }
        }

        // Drag & Drop handlers
        const fileSource = document.getElementById('fileSource');
        const fileInput = document.getElementById('fileInput');
        const clickToUpload = document.getElementById('clickToUpload');

        fileSource.addEventListener('click', (e) => {
          if (e.target === clickToUpload || e.target === fileSource) {
            fileInput.click();
          }
        });

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
          fileSource.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
          e.preventDefault();
          e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
          fileSource.addEventListener(eventName, highlight, false);
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
          fileSource.addEventListener(eventName, unhighlight, false);
        });

        function highlight(e) {
          fileSource.classList.add('dragover');
        }

        function unhighlight(e) {
          fileSource.classList.remove('dragover');
        }

        fileInput.addEventListener('change', handleFileSelect);
        fileSource.addEventListener('drop', handleDrop);

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
              showResult('error', '<h3>❌ Archivo demasiado grande</h3><p>Máximo 4MB</p>');
              return;
            }
            document.getElementById('fileInfo').innerHTML = \`
              <strong>\${currentFile.name}</strong><br>
              \${(currentFile.size / 1024).toFixed(1)} KB - \${currentFile.type}
            \`;
            document.getElementById('fileInfo').style.display = 'block';
            document.getElementById('uploadBtn').disabled = false;
            currentUrl = null;
          }
        }

        document.getElementById('uploadBtn').addEventListener('click', uploadFile);

        async function uploadFile() {
          if (currentSource === 'file' && !currentFile) return;
          if (currentSource === 'url' && !currentUrl) return;
          
          const uploadBtn = document.getElementById('uploadBtn');
          const progressDiv = document.getElementById('progress');
          const resultDiv = document.getElementById('result');
          const progressBar = document.getElementById('progressBar');
          
          uploadBtn.disabled = true;
          uploadBtn.textContent = '⏳ Subiendo...';
          progressDiv.style.display = 'block';
          resultDiv.style.display = 'none';
          
          const formData = new FormData();
          formData.append('folder', document.getElementById('folder').value);
          formData.append('target', document.getElementById('target').value);
          
          const customNameValue = document.getElementById('customName').value.trim();
          if (customNameValue) formData.append('customName', customNameValue);
          
          if (currentSource === 'file') {
            formData.append('file', currentFile);
          } else {
            formData.append('urlSource', currentUrl);
          }
          
          let progressInterval;
          try {
            const response = await fetch('/upload-image', { method: 'POST', body: formData });
            const data = await response.json();
            
            progressInterval = setInterval(() => {
              const width = parseInt(progressBar.style.width) || 0;
              progressBar.style.width = Math.min(95, width + 5) + '%';
            }, 200);
            
            clearInterval(progressInterval);
            progressBar.style.width = '100%';
            
            if (response.ok && data.success) {
              let sourceText = data.source === 'url' ? '🌐 URL' : '📁 Archivo';
              let targetText = data.target === 'cloudinary' ? '☁️ Cloudinary' : '📦 Vercel Blob';
              
              // ✅ FIX: HTML CON MÚLTIPLES PREVIEWS Y ENLACES LEGIBLES
              let htmlContent = \`
                <h3>✅ Subida exitosa desde \${sourceText} a \${targetText}</h3>
                <p><strong>Origen:</strong> \${sourceText}</p>
                <p><strong>Destino:</strong> \${targetText}</p>
                <p><strong>Carpeta:</strong> \${data.folder}</p>
                <p><strong>Archivo:</strong> \${data.filename}</p>
                <p><strong>Tamaño:</strong> \${(data.size / 1024).toFixed(1)} KB</p>
                
                <div class="url-box">
                  <strong>🌟 URL Principal (Stremio):</strong><br>
                  <a href="\${data.url}" target="_blank">\${data.url}</a>
                </div>
              \`;
              
              // URL original
              if (data.originalUrl && data.originalUrl !== data.url) {
                htmlContent += \`
                  <div class="url-box">
                    <strong>📸 URL Original:</strong><br>
                    <a href="\${data.originalUrl}" target="_blank">\${data.originalUrl}</a>
                  </div>
                \`;
              }
              
              // ✅ FIX: Múltiples formatos con mini-previews
              if (data.formats) {
                let formatsHtml = '<details><summary>📋 Formatos disponibles (' + Object.keys(data.formats).length + ')</summary>';
                Object.entries(data.formats).forEach(([key, url]) => {
                  const displayKey = key.replace(/_/g, ' ').toUpperCase();
                  formatsHtml += \`
                    <div class="format-box">
                      <strong>\${displayKey}:</strong><br>
                      <small style="word-break: break-all;">
                        <a href="\${url}" target="_blank">\${url}</a>
                      </small>
                      <br>
                      <img src="\${url}" class="format-preview preview" 
                           alt="\${displayKey}" 
                           onload="this.style.display='block'" 
                           style="display:none; margin-top: 5px;">
                    </div>
                  \`;
                });
                formatsHtml += '</details>';
                htmlContent += formatsHtml;
              }
              
              // ✅ FIX: Previews principales en grid
              htmlContent += \`
                <div class="previews-container">
                  <img src="\${data.url}" alt="Preview Principal" class="preview" 
                       onload="this.style.display='block'" 
                       style="display:none;">
              \`;
              
              if (data.originalUrl && data.originalUrl !== data.url) {
                htmlContent += \`
                  <img src="\${data.originalUrl}" alt="Preview Original" class="preview" 
                       onload="this.style.display='block'" 
                       style="display:none;">
                \`;
              }
              
              htmlContent += '</div>';
              
              showResult('success', htmlContent);
            } else {
              showResult('error', \`<h3>❌ Error: \${data.error}</h3><p><strong>Tipo:</strong> \${data.type}</p>\`);
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
          const resultDiv = document.getElementById('result');
          resultDiv.className = type;
          resultDiv.innerHTML = html;
          resultDiv.style.display = 'block';
          document.getElementById('progress').style.display = 'none';
        }

        function resetUpload() {
          currentFile = null;
          currentUrl = null;
          document.getElementById('fileInfo').style.display = 'none';
          document.getElementById('urlInfo').style.display = 'none';
          document.getElementById('uploadBtn').disabled = true;
          document.getElementById('renameSection').classList.remove('active');
          document.getElementById('renameBtn').textContent = '✏️ Renombrar imagen';
          document.getElementById('customName').value = '';
          document.getElementById('urlInput').value = '';
        }
      </script>
    </body>
    </html>`);
};
