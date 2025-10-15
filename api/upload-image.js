// api/upload-image.js
'use strict';

const { put } = require('@vercel/blob');
const formidable = require('formidable');
const fs = require('fs').promises;
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

      const folder = fields.folder; // v2: string directo
      const target = fields.target || 'cloudinary'; // Nuevo campo: cloudinary o blob
      const file = files.file; // v2: objeto File
      
      console.log('📁 Folder recibido:', folder);
      console.log('🎯 Target recibido:', target);
      console.log('📄 File recibido:', file?.originalFilename);

      if (!file) {
        res.status(400).json({ error: 'No image file', type: 'NO_FILE' });
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

      const originalName = file.originalFilename || `${Date.now()}.png`;
      
      try {
        const buffer = await fs.readFile(file.filepath);
        console.log(`📊 Buffer: ${(buffer.length / 1024).toFixed(1)} KB`);
        console.log(`🚀 Subiendo a: ${target}`);

        let result;

        // Switch según target seleccionado
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

        // Cleanup temporal
        fs.unlink(file.filepath).catch(console.warn);

        res.json({
          success: true,
          url: result.url,
          target,
          folder,
          filename: originalName,
          size: result.size || buffer.length,
          ...(result.public_id && { public_id: result.public_id }),
          ...(result.width && { width: result.width, height: result.height }),
        });

      } catch (uploadError) {
        console.error('Upload error:', uploadError);
        res.status(500).json({ 
          error: uploadError.message, 
          type: 'UPLOAD_ERROR',
          target 
        });
      }
    });
    return;
  }

  // HTML con selector de target (Cloudinary por defecto)
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
        .target-selector {
          background: linear-gradient(90deg, #ff6b6b, #4ecdc4);
          padding: 1rem;
          border-radius: 8px;
          margin: 1rem 0;
        }
        .target-selector select { background: #333; border-color: #555; }
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
        .folder-selector, .target-selector { margin-bottom: 1rem; }
        label { display: block; margin-bottom: 0.5rem; font-weight: bold; }
        .progress { width: 100%; height: 20px; background: #333; border-radius: 10px; overflow: hidden; margin: 1rem 0; }
        .progress-bar { height: 100%; background: #0070f3; width: 0%; transition: width 0.3s; }
        .warning { color: #ffaa00; font-size: 0.9rem; margin-top: 0.5rem; }
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
          <option value="Canales">📺 Canales</option>
          <option value="plantillas">📋 Plantillas</option>
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
      <div class="warning">⚠️ Cloudinary optimiza automáticamente (WebP, resize, CDN global)</div>

      <script>
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const uploadBtn = document.getElementById('uploadBtn');
        const folderSelect = document.getElementById('folder');
        const targetSelect = document.getElementById('target');
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
          formData.append('target', targetSelect.value); // Nuevo campo
          
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
              let targetText = data.target === 'cloudinary' ? '☁️ Cloudinary' : '📦 Vercel Blob';
              showResult('success', \`
                <h3>✅ Subida exitosa a \${targetText}</h3>
                <p><strong>Destino:</strong> \${targetText}</p>
                <p><strong>Carpeta:</strong> \${data.folder}</p>
                <p><strong>Archivo:</strong> \${data.filename}</p>
                <p><strong>Tamaño:</strong> \${(data.size / 1024).toFixed(1)} KB</p>
                \${data.width ? '<p><strong>Dimensiones:</strong> ' + data.width + 'x' + data.height + '</p>' : ''}
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
                <p><strong>Destino:</strong> \${data.target || targetSelect.value}</p>
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
