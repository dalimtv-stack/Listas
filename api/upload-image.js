// api/upload-image.js
'use strict';

const { put } = require('@vercel/blob');
const formidable = require('formidable');
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  // IMPORTANTE: Deshabilitar body parser de Vercel para POST
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    // Parsear multipart/form-data manualmente
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB
      keepExtensions: true,
      multiples: false,
      filter: ({ mimetype }) => mimetype && mimetype.startsWith('image/'),
      uploadDir: '/tmp', // Directorio temporal
      filename: (name, ext, part) => {
        return part.originalFilename || `${Date.now()}_${name}`;
      }
    });

    try {
      console.log('📤 Iniciando parseo de formulario...');
      
      const [fields, files] = await form.parse(req);
      
      console.log('📋 Campos recibidos:', fields);
      console.log('📁 Archivos recibidos:', Object.keys(files));
      
      const folder = fields.folder?.[0];
      const file = files.file?.[0];
      
      if (!file) {
        console.error('❌ No se recibió archivo');
        return res.status(400).json({ 
          error: 'No se recibió archivo de imagen',
          received: { fields: Object.keys(fields || {}), files: Object.keys(files || {}) }
        });
      }

      if (!folder || !['plantillas', 'Canales'].includes(folder)) {
        console.error('❌ Carpeta inválida:', folder);
        return res.status(400).json({ 
          error: 'Carpeta inválida. Debe ser "plantillas" o "Canales"',
          receivedFolder: folder
        });
      }

      // Nombre original SIN renombrar
      const originalName = file.originalFilename || path.basename(file.newFilename);
      const blobName = `${folder}/${originalName}`;
      
      console.log(`📁 Leyendo archivo: ${file.filepath}`);
      
      // Leer buffer
      const buffer = await fs.promises.readFile(file.filepath);
      console.log(`📊 Buffer leído: ${(buffer.length / 1024).toFixed(1)} KB`);
      
      if (!buffer || buffer.length === 0) {
        // Limpiar archivo temporal
        try { fs.unlinkSync(file.filepath); } catch(e) {}
        return res.status(400).json({ error: 'Archivo vacío' });
      }

      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.error('❌ BLOB_READ_WRITE_TOKEN no configurado');
        try { fs.unlinkSync(file.filepath); } catch(e) {}
        return res.status(500).json({ 
          error: 'Token de Vercel Blob no configurado',
          type: 'CONFIG_ERROR'
        });
      }

      console.log(`🚀 Subiendo ${originalName} a ${blobName}...`);
      
      // Subida a Vercel Blob
      const result = await put(blobName, buffer, {
        access: 'public',
        contentType: file.mimetype || 'image/png',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false
      });

      // Limpiar archivo temporal
      try {
        fs.unlinkSync(file.filepath);
        console.log('🧹 Archivo temporal limpiado');
      } catch (cleanupErr) {
        console.warn('⚠️ No se pudo limpiar archivo temporal:', cleanupErr.message);
      }

      if (result && result.url) {
        console.log(`✅ ¡SUBIDA EXITOSA! URL: ${result.url}`);
        return res.json({ 
          success: true,
          url: result.url,
          blobName,
          folder,
          filename: originalName,
          size: buffer.length,
          mimetype: file.mimetype
        });
      } else {
        console.error('❌ put() no devolvió URL válida:', result);
        return res.status(500).json({ 
          error: 'Error interno de Vercel Blob',
          type: 'BLOB_RESPONSE_ERROR',
          result
        });
      }

    } catch (error) {
      console.error('💥 ERROR COMPLETO:', error);
      
      // Limpiar archivos temporales
      if (files?.file?.[0]?.filepath) {
        try { fs.unlinkSync(files.file[0].filepath); } catch(e) {}
      }
      
      let errorType = 'UNKNOWN';
      let errorMessage = error.message;
      
      if (error.message.includes('BLOB_READ_WRITE_TOKEN')) {
        errorType = 'TOKEN_ERROR';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        errorType = 'NETWORK_ERROR';
      } else if (error.message.includes('quota') || error.message.includes('limit')) {
        errorType = 'QUOTA_ERROR';
      } else if (error.message.includes('maxFileSize')) {
        errorType = 'FILE_TOO_LARGE';
        errorMessage = 'Archivo demasiado grande (máximo 10MB)';
      }

      return res.status(500).json({ 
        error: errorMessage,
        type: errorType,
        stack: error.stack
      });
    }
  }

  // GET: Mostrar página HTML
  console.log('🌐 Mostrando página de upload');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Subir Imagen</title>
      <style>
        body { background: #111; color: #eee; font-family: Arial, sans-serif; max-width: 700px; margin: 2rem auto; padding: 1rem; }
        .upload-area { background: #1a1a1a; padding: 2rem; border-radius: 8px; border: 2px dashed #333; cursor: pointer; }
        .upload-area.dragover { border-color: #0070f3; background: #222; }
        select, button { padding: 0.7rem; margin: 0.5rem; border-radius: 6px; border: 1px solid #333; background: #222; color: #fff; }
        button { background: #0070f3; border: none; cursor: pointer; }
        button:disabled { background: #666; }
        #result { margin-top: 1rem; padding: 1rem; border-radius: 6px; display: none; }
        .success { background: #1a4f1a; }
        .error { background: #4f1a1a; }
        .url-box { background: #222; padding: 1rem; word-break: break-all; margin: 1rem 0; }
        .debug { background: #333; padding: 1rem; margin: 1rem 0; font-family: monospace; font-size: 0.8rem; }
      </style>
    </head>
    <body>
      <h1>🖼️ Subir Imagen a Vercel Blob</h1>
      
      <select id="folder">
        <option value="plantillas">📋 Plantillas</option>
        <option value="Canales">📺 Canales</option>
      </select>
      
      <div class="upload-area" id="uploadArea">
        <p>📁 Arrastra imagen o <span id="clickUpload">haz clic</span></p>
        <input type="file" id="fileInput" accept="image/*" style="display:none;">
        <div id="fileInfo"></div>
      </div>
      
      <button id="uploadBtn" disabled>🚀 Subir</button>
      
      <div id="debug" class="debug" style="display:none;"></div>
      <div id="result"></div>

      <script>
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const uploadBtn = document.getElementById('uploadBtn');
        const folderSelect = document.getElementById('folder');
        const result = document.getElementById('result');
        const debug = document.getElementById('debug');
        let currentFile = null;

        uploadArea.addEventListener('click', () => fileInput.click());
        document.getElementById('clickUpload').addEventListener('click', () => fileInput.click());

        // Drag & Drop
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => 
          uploadArea.addEventListener(e, e => e.preventDefault())
        );
        uploadArea.addEventListener('drop', e => {
          const files = e.dataTransfer.files;
          if (files.length) handleFile(files[0]);
        });
        uploadArea.addEventListener('dragover', e => uploadArea.classList.add('dragover'));
        uploadArea.addEventListener('dragleave', e => uploadArea.classList.remove('dragover'));

        fileInput.addEventListener('change', e => {
          if (e.target.files[0]) handleFile(e.target.files[0]);
        });

        function handleFile(file) {
          currentFile = file;
          document.getElementById('fileInfo').innerHTML = 
            \`<strong>\${file.name}</strong> (\${(file.size/1024).toFixed(1)}KB)\`;
          uploadBtn.disabled = false;
        }

        uploadBtn.addEventListener('click', async () => {
          if (!currentFile) return;
          
          uploadBtn.disabled = true;
          uploadBtn.textContent = '⏳ Subiendo...';
          result.style.display = 'none';
          debug.style.display = 'none';
          
          const formData = new FormData();
          formData.append('file', currentFile);
          formData.append('folder', folderSelect.value);
          
          try {
            console.log('📤 Enviando POST a /upload-image');
            const response = await fetch('/upload-image', {
              method: 'POST',
              body: formData
            });
            
            const data = await response.json();
            console.log('📥 Respuesta:', data);
            
            debug.innerHTML = \`
              <strong>Status:</strong> \${response.status}<br>
              <strong>OK:</strong> \${response.ok}<br>
              <strong>Response:</strong> \${JSON.stringify(data, null, 2)}
            \`;
            debug.style.display = 'block';
            
            if (response.ok && data.success) {
              result.innerHTML = \`
                <div class="success">
                  <h3>✅ ¡SUBIDA EXITOSA!</h3>
                  <div class="url-box">
                    <strong>URL:</strong><br><a href="\${data.url}" target="_blank">\${data.url}</a>
                  </div>
                  <img src="\${data.url}" style="max-width:300px;" />
                </div>
              \`;
            } else {
              result.innerHTML = \`
                <div class="error">
                  <h3>❌ Error: \${data.error}</h3>
                  <p><strong>Tipo:</strong> \${data.type || 'N/A'}</p>
                </div>
              \`;
            }
            result.style.display = 'block';
          } catch (err) {
            console.error('Error:', err);
            result.innerHTML = \`<div class="error">Error de red: \${err.message}</div>\`;
            result.style.display = 'block';
          }
          
          uploadBtn.disabled = false;
          uploadBtn.textContent = '🚀 Subir';
        });
      </script>
    </body>
    </html>
  `);
};
