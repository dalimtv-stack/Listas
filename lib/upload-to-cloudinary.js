// lib/upload-to-cloudinary.js - FIX REGEX Y MÚLTIPLES FORMATO
'use strict';

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Función helper para limpiar URL de Cloudinary (FIX REGEX)
function cleanCloudinaryUrl(dirtyUrl) {
  return dirtyUrl
    .replace(/\/v\d+\//g, '/')  // Quita /v1/
    .replace(/\/f_auto,q_auto/g, '/q_auto,f_auto'); // Corrige orden
}

async function uploadImageCloudinary(buffer, filename, folder = 'Canales') {
  if (!['plantillas', 'Canales'].includes(folder)) {
    throw new Error(`Invalid folder: ${folder}. Use 'plantillas' or 'Canales'`);
  }

  const parts = filename.split('.');
  const extension = parts.pop().toLowerCase();
  const publicId = parts.join('.');
  
  console.log(`📤 Subiendo "${filename}" → public_id: "${publicId}" en carpeta "${folder}"`);

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { 
        folder: folder,
        public_id: publicId,
        resource_type: 'image',
        overwrite: true,
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
          const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
          const cleanPublicId = result.public_id;
          
          // ✅ MÚLTIPLES FORMATO CON URLs LIMPAS (STRING DIRECTO)
          const formats = {
            // 1. Formato principal Stremio (tu preferido)
            stremio_optimized: `https://res.cloudinary.com/${cloudName}/image/upload/ar_0.675,b_auto,c_pad,w_405,q_auto,f_auto/${cleanPublicId}`,
            
            // 2. Con gravity center
            center_crop: `https://res.cloudinary.com/${cloudName}/image/upload/ar_0.675,g_center,w_405,f_auto/${cleanPublicId}`,
            
            // 3. Solo formato auto (simple)
            simple_auto: `https://res.cloudinary.com/${cloudName}/image/upload/f_auto/${cleanPublicId}`,
            
            // 4. Quality auto explícito
            quality_auto: `https://res.cloudinary.com/${cloudName}/image/upload/q_auto,f_auto/${cleanPublicId}`,
            
            // 5. Original sin transformaciones
            original: `https://res.cloudinary.com/${cloudName}/image/upload/${cleanPublicId}`,
            
            // 6. Con fill (alternativa)
            stremio_fill: `https://res.cloudinary.com/${cloudName}/image/upload/ar_0.675,c_fill,g_auto,w_405,q_auto,f_auto/${cleanPublicId}`,
            
            // 7. Responsive
            responsive: `https://res.cloudinary.com/${cloudName}/image/upload/w_auto,q_auto,f_auto/${cleanPublicId}`,
            
            // 8. Alta calidad
            high_quality: `https://res.cloudinary.com/${cloudName}/image/upload/q_90,f_auto/${cleanPublicId}`
          };

          // URL principal (optimizada para Stremio)
          const stremioUrl = formats.stremio_optimized;
          
          // URL original (Cloudinary oficial, puede tener /v1/)
          const originalUrl = cloudinary.url(result.public_id, {
            secure: true,
            resource_type: "image"
          });

          console.log('✅ Upload exitoso:');
          console.log(`   Public ID: ${result.public_id}`);
          console.log(`   Stremio URL: ${stremioUrl}`);
          console.log('   📋 Formatos disponibles:', Object.keys(formats));

          resolve({
            success: true,
            url: stremioUrl,                    // ← Principal limpia
            originalUrl: originalUrl,           // ← Oficial (puede tener v1)
            formats: formats,                   // ← TODOS los formatos limpios
            public_id: result.public_id,
            folder: folder,
            filename: filename,
            size: result.bytes,
            width: result.width,
            height: result.height,
            format: result.format || extension,
            version: result.version,
            signature: result.signature
          });
        }
      }
    );
    
    stream.end(buffer);
  });
}

module.exports = { uploadImageCloudinary };
