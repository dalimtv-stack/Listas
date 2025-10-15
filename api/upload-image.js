// api/upload-image.js - VERSIÓN FUNCIONAL
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
        console.error('Formidable error:', err);
        res.status(500).json({ error: err.message, type: 'PARSE_ERROR' });
        return;
      }

      const folder = fields.folder;
      const target = fields.target || 'cloudinary';
      const customName = fields.customName || null;
      const file = files.file;
      
      console.log('Folder:', folder, 'Target:', target);

      if (!file) {
        res.status(400).json({ error: 'No image file', type: 'NO_FILE' });
        return;
      }

      if (!folder || !['plantillas', 'Canales'].includes(folder)) {
        res.status(400).json({ 
          error: 'Invalid folder: ' + folder, 
          type: 'INVALID_FOLDER' 
        });
        return;
      }

      if (!['cloudinary', 'blob'].includes(target)) {
        res.status(400).json({ 
          error: 'Invalid target: ' + target, 
          type: 'INVALID_TARGET' 
        });
        return;
      }

      const originalName = customName || file.originalFilename || Date.now() + '.png';
      
      try {
        const buffer = await fs.readFile(file.filepath);
        
        let result;
        if (target === 'cloudinary') {
          result = await uploadImageCloudinary(buffer, originalName, folder);
        } else {
          result = await uploadImageBlob(buffer, originalName, folder);
        }

        fs.unlink(file.filepath).catch(console.warn);

        res.json({
          success: true,
          url: result.url,
          target,
          folder,
          filename: originalName,
          size: buffer.length,
        });
      } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message, type: 'UPLOAD_ERROR' });
      }
    });
    return;
  }

  // HTML SIMPLE - SIN TEMPLATE LITERALS COMPLEJOS
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Subir Imagen</title>
  <style>
    body { background: #111; color: #eee; font-family: Arial; max-width: 700px; margin: 2rem auto; padding: 1rem; text-align: center; }
    .upload-area { background: #1a1a1a; padding: 2rem; border-radius: 8px; border: 2px dashed #333; margin: 1rem 0; cursor: pointer; }
    .upload-area:hover { border-color: #0070f3; }
    .upload-area.dragover { border-color: #0070f3; background: #222; }
    input[type="file"] { display: none; }
    select, input[type="text"] { width: 100%; max-width: 400px; padding: 0.7rem; margin: 0.5rem 0; border-radius: 6px; border: 1px solid #333; background: #222; color: #fff; }
    button { background: #0070f3; color: white; border: none; padding: 0.8rem 1.5rem; border-radius: 6px; cursor: pointer; margin: 0.5rem; }
    button:hover:not(:disabled) { background: #0059c9; }
    button:disabled { background: #666; }
    #result { margin-top: 1.5rem; padding: 1rem; border-radius: 8px; text-align: left; display: none; }
    .success { background: #1a4f1a; border: 1px solid #2d7a2d; }
    .error { background: #4f1a1a; border: 1px solid #7a2d2d; }
    .url-box { background: #222; padding: 1rem; border-radius: 6px; margin: 1rem 0; word-break: break-all; font-family: monospace; }
    img.preview { max-width: 300px; max-height: 400px; border-radius: 6px; margin-top: 1rem; }
    .file-info { font-size: 0.9rem; color: #aaa; margin-top: 0.5rem; }
    label { display: block; margin-bottom: 0.5rem; font-weight: bold; }
    .progress { width: 100%; height: 20px; background: #333; border-radius: 10px; overflow: hidden; margin: 1rem 0; }
    .progress-bar { height: 100%; background: #0070f3; width: 0%; transition: width 0.3s; }
  </style>
</head>
<body>
  <h1>🖼️ Subir Imagen</h1>
  <p>Máximo 4MB por imagen</p>
  
  <div>
    <label>Carpeta:</label>
    <select id="folder">
      <option value="plantillas">📋 Plantillas</option>
      <option value="Canales">📺 Canales</option>
    </select>
  </div>
  
  <div>
    <label>Destino:</label>
    <select id="target">
      <option value="cloudinary">☁️ Cloudinary (Recomendado)</option>
      <option value="blob">📦 Vercel Blob</option>
    </select>
  </div>
  
  <div class="upload-area" id="uploadArea">
    <p>📁 Arrastra imagen o haz clic</p>
    <div id="fileInfo" class="file-info" style="display:none;"></div>
    <input type="file" id="fileInput" accept="image/*">
  </div>
  
  <div id="renameSection" style="display:none;">
    <label>Nombre:</label>
    <input type="text" id="customName" placeholder="Nombre.jpg">
  </div>
  
  <button id="renameBtn" onclick="toggleRename()">✏️ Renombrar</button>
  <button id="uploadBtn" disabled>🚀 Subir</button>
  
  <div class="progress" id="progress" style="display:none;">
    <div class="progress-bar" id="progressBar"></div>
  </div>
  <div id="result"></div>

  <script>
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const folderSelect = document.getElementById('folder');
    const targetSelect = document.getElementById('target');
    let currentFile = null;
    const MAX_SIZE = 4 * 1024 * 1024;

    uploadArea.addEventListener('click', () => fileInput.click());
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => {
      uploadArea.addEventListener(e, preventDefaults);
    });
    ['dragenter', 'dragover'].forEach(e => {
      uploadArea.addEventListener(e, () => uploadArea.classList.add('dragover'));
    });
    ['dragleave', 'drop'].forEach(e => {
      uploadArea.addEventListener(e, () => uploadArea.classList.remove('dragover'));
    });

    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    fileInput.addEventListener('change', e => {
      if (e.target.files[0]) {
        currentFile = e.target.files[0];
        if (currentFile.size > MAX_SIZE) {
          alert('Archivo demasiado grande');
          return;
        }
        document.getElementById('fileInfo').innerHTML = currentFile.name + ' - ' + (currentFile.size/1024).toFixed(1) + 'KB';
        document.getElementById('fileInfo').style.display = 'block';
        uploadBtn.disabled = false;
      }
    });

    uploadArea.addEventListener('drop', e => {
      const files = e.dataTransfer.files;
      if (files[0]) {
        fileInput.files = files;
        fileInput.dispatchEvent(new Event('change'));
      }
    });

    function toggleRename() {
      const section = document.getElementById('renameSection');
      section.style.display = section.style.display === 'none' ? 'block' : 'none';
    }

    uploadBtn.addEventListener('click', async () => {
      if (!currentFile) return;
      
      const formData = new FormData();
      formData.append('file', currentFile);
      formData.append('folder', folderSelect.value);
      formData.append('target', targetSelect.value);
      const customName = document.getElementById('customName').value;
      if (customName) formData.append('customName', customName);
      
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Subiendo...';
      document.getElementById('progress').style.display = 'block';
      
      try {
        const response = await fetch('/upload-image', { method: 'POST', body: formData });
        const data = await response.json();
        
        document.getElementById('progressBar').style.width = '100%';
        
        if (data.success) {
          document.getElementById('result').innerHTML = 
            '<div class="success"><h3>✅ Exito</h3><p>URL: <a href="' + data.url + '" target="_blank">' + data.url + '</a></p><img src="' + data.url + '" class="preview"></div>';
        } else {
          document.getElementById('result').innerHTML = 
            '<div class="error"><h3>❌ Error: ' + data.error + '</h3></div>';
        }
        document.getElementById('result').style.display = 'block';
      } catch (err) {
        document.getElementById('result').innerHTML = '<div class="error"><h3>❌ Error de red</h3></div>';
        document.getElementById('result').style.display = 'block';
      } finally {
        setTimeout(() => {
          document.getElementById('progress').style.display = 'none';
          uploadBtn.disabled = false;
          uploadBtn.textContent = '🚀 Subir';
        }, 2000);
      }
    });
  </script>
</body>
</html>
  `);
};
