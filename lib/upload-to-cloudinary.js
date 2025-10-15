// lib/upload-to-cloudinary.js - MÉTODO OFICIAL CLOUDINARY
'use strict';

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadImageCloudinary(buffer, filename, folder = 'Canales') {
  // Validar carpeta
  if (!['plantillas', 'Canales'].includes(folder)) {
    throw new Error(`Invalid folder: ${folder}. Use 'plantillas' or 'Canales'`);
  }

  // Extraer nombre y extensión del filename personalizado
  const parts = filename.split('.');
  const extension = parts.pop().toLowerCase();
  const publicId = parts.join('.'); // Soporta nombres con puntos: "Mi.Imagen.jpg" → "Mi.Imagen"
  
  console.log(`📤 Subiendo "${filename}" → public_id: "${publicId}" en carpeta "${folder}"`);

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { 
        folder: folder,
        public_id: publicId, // ← NOMBRE PERSONALIZADO SIN EXTENSIÓN
        resource_type: 'image',
        overwrite: true, // Sobreescribe si existe
        // No especificamos format aquí, Cloudinary detecta automáticamente
      },
      (error, result) => {
        if (error) {
          console.error('❌ Cloudinary upload error:', {
            message: error.message,
            http_code: error.http_code,
            public_id: publicId,
            folder: folder
          });
          reject(error);
        } else {
          // ✅ MÉTODO OFICIAL: cloudinary.url() con transformation array
          const stremioUrl = cloudinary.url(result.public_id, {
            transformation: [
              { 
                width: 405, 
                height: 600, 
                crop: "fill", // Rellena manteniendo proporción
                gravity: "auto" // Centro inteligente
              },
              { quality: "auto" }, // Optimización automática
              { fetch_format: "auto" } // WebP/AVIF cuando posible
            ],
            secure: true, // HTTPS
            resource_type: "image"
          });

          // URL original sin transformaciones (para debug)
          const originalUrl = cloudinary.url(result.public_id, {
            secure: true,
            resource_type: "image"
          });

          console.log('✅ Upload exitoso:');
          console.log(`   Public ID: ${result.public_id}`);
          console.log(`   Stremio URL: ${stremioUrl}`);
          console.log(`   Tamaño: ${result.bytes} bytes (${(result.bytes / 1024).toFixed(1)} KB)`);
          console.log(`   Original: ${result.width}x${result.height}`);

          resolve({
            success: true,
            url: stremioUrl, // ← URL OPTIMIZADA PARA STREMIO (w_405,h_600)
            originalUrl: originalUrl, // ← URL sin transformaciones
            public_id: result.public_id,
            folder: folder,
            filename: filename, // ← NOMBRE ORIGINAL QUE ELIGIÓ EL USUARIO
            size: result.bytes,
            width: result.width,
            height: result.height,
            format: result.format || extension,
            // Metadata adicional
            version: result.version,
            signature: result.signature
          });
        }
      }
    );
    
    // Enviar buffer al stream
    stream.end(buffer);
  });
}

module.exports = { uploadImageCloudinary };
