// api/upload-image.js
'use strict';

const { put } = require('@vercel/blob');
const path = require('path');
const fs = require('fs');

module.exports = async (req, res) => {
  // Validar método y parámetros para API
  if (req.method === 'POST' && req.body && req.body.file && req.body.folder) {
    const { file: fileData, folder } = req.body;
    
    if (!['plantillas', 'Canales'].includes(folder)) {
      console.error('Carpeta inválida:', folder);
      return res.status(400).json({ 
        error: 'Carpeta inválida. Debe ser "plantillas" o "Canales"', 
        folder: null, 
        filename: null 
      });
    }

    // Validar que sea imagen
    if (!fileData.type || !fileData.type.startsWith('image/')) {
      console.error('Tipo de archivo inválido:', fileData.type);
      return res.status(400).json({ 
        error: 'Solo se permiten archivos de imagen', 
        folder, 
        filename: fileData.name || null 
      });
    }

    // Usar nombre original sin renombrar
    const originalName = fileData.name || 'imagen.png';
    const blobName = `${folder}/${originalName}`;
    const buffer = Buffer.from(fileData.data, 'base64'); // Asumiendo base64 en el body

    if (!buffer || buffer.length === 0) {
      console.error('Buffer vacío para:', originalName);
      return res.status(400).json({ 
        error: 'Archivo vacío o corrupto', 
        folder, 
        filename: originalName 
      });
    }

    try {
      // Verificar token
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.error('BLOB_READ_WRITE_TOKEN no configurado');
        return res.status(500).json({ 
          error: 'Token de Vercel Blob no configurado en el servidor', 
          type: 'CONFIG_ERROR',
          folder, 
          filename: originalName 
        });
      }

      console.log(`Subiendo ${originalName} a ${folder}/...`);

      // Subida directa SIN verificar existencia (minimizando operaciones)
      const result = await put(blobName, buffer, {
        access: 'public',
        contentType: fileData.type,
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false // Mantiene nombre original
      });

      if (result && result.url) {
        console.log(`✅ Subida exitosa: ${result.url}`);
        return res.json({ 
          success: true, 
          url: result.url, 
          blobName, 
          folder, 
          filename: originalName,
          size: buffer.length 
        });
      } else {
        console.error('put() no devolvió URL válida');
        return res.status(500).json({ 
          error: 'Error interno: No se obtuvo URL de Vercel Blob', 
          type: 'BLOB_RESPONSE_ERROR',
          folder, 
          filename: originalName 
        });
      }

    } catch (error) {
      console.error('Error subiendo archivo:', error.message);
      
      let errorType = 'UNKNOWN';
      let errorMessage = 'Error desconocido al subir archivo';
      
      if (error.message.includes('BLOB_READ_WRITE_TOKEN')) {
        errorType = 'TOKEN_ERROR';
        errorMessage = 'Token de Vercel Blob inválido o expirado';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        errorType = 'NETWORK_ERROR';
        errorMessage = 'Error de conexión con Vercel Blob';
      } else if (error.message.includes('permission') || error.message.includes('access')) {
        errorType = 'PERMISSION_ERROR';
        errorMessage = 'Sin permisos para subir a Vercel Blob';
      } else if (error.message.includes('quota') || error.message.includes('limit')) {
        errorType = 'QUOTA_ERROR';
        errorMessage = 'Límite de almacenamiento alcanzado';
      } else if (error.message.includes('Invalid') && error.message.includes('name')) {
        errorType = 'FILENAME_ERROR';
        errorMessage = 'Nombre de archivo inválido para Vercel Blob';
      }

      return res.status(500).json({ 
        error: errorMessage,
        type: errorType,
        details: error.message,
        folder, 
        filename: originalName 
      });
    }
  }

  // Si no es POST válido, mostrar página HTML
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
        input[type="file"] {
          display: none;
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
      </style>
    </head>
    <body>
      <h1>🖼️ Subir Imagen a Vercel Blob</h1>
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
        <input type="file" id="fileInput" accept="image/*" />
        <div id="fileInfo" class="file-info" style="display: none;"></div>
      </div>
      
      <button id="uploadBtn" disabled>🚀 Subir Imagen</button>
      <div id="result"></div>

      <script>
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const uploadBtn = document.getElementById('uploadBtn');
        const folderSelect = document.getElementById('folder');
        const resultDiv = document.getElementById('result');
        const clickToUpload = document.getElementById('clickToUpload');
        let currentFile = null;

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
            const fileInfo = document.getElementById('fileInfo');
            fileInfo.textContent = \`\${currentFile.name} (\${(currentFile.size / 1024).toFixed(1)} KB)\`;
            fileInfo.style.display = 'block';
            uploadBtn.disabled = false;
          }
        }

        uploadBtn.addEventListener('click', uploadFile);

        async function uploadFile() {
          if (!currentFile) return;
          
          uploadBtn.disabled = true;
          uploadBtn.textContent = '⏳ Subiendo...';
          resultDiv.style.display = 'none';
          
          const reader = new FileReader();
          reader.onload = async function(e) {
            const base64Data = e.target.result.split(',')[1]; // Remove data:image/...;base64,
            
            try {
              const formData = {
                file: {
                  name: currentFile.name,
                  type: currentFile.type,
                  data: base64Data
                },
                folder: folderSelect.value
              };
              
              const response = await fetch('/api/upload-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
              });
              
              const data = await response.json();
              
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
                  <p><strong>Archivo:</strong> \${data.filename}</p>
                  <p><strong>Carpeta:</strong> \${data.folder}</p>
                \`);
              }
            } catch (err) {
              showResult('error', '<h3>❌ Error de red</h3><p>' + err.message + '</p>');
            } finally {
              uploadBtn.disabled = false;
              uploadBtn.textContent = '🚀 Subir Imagen';
            }
          };
          
          reader.readAsDataURL(currentFile);
        }

        function showResult(type, html) {
          resultDiv.className = type;
          resultDiv.innerHTML = html;
          resultDiv.style.display = 'block';
        }
      </script>
    </body>
    </html>
  `);
};
