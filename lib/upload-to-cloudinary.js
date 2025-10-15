// lib/upload-to-cloudinary.js - MÚLTIPLES FORMATO + URL LIMPIA
'use strict';

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Función helper para limpiar URL de Cloudinary
function cleanCloudinaryUrl(dirtyUrl) {
  return dirtyUrl
    .replace(/\/v\d+\//, '/')           // Quita /v1/
    .replace(/\/f_auto,q_auto/, '/q_auto,f_auto') // Corrige orden
    .replace(/g_(center|auto), '');     // Quita g_ innecesarios si quieres
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
          console.error('❌ Cloudinary upload error:', error);
          reject(error);
        } else {
          const baseUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`;
          const cleanPublicId = result.public_id.replace(/\//g, '/'); // Escapa slashes
          
          // ✅ MÚLTIPLES FORMATO PARA COPIAR/VISUALIZAR
          const formats = {
            // 1. Tu formato ideal (limpio)
            stremio_optimized: `${baseUrl}/ar_0.675,b_auto,c_pad,w_405,q_auto,f_auto/${cleanPublicId}`,
            
            // 2. Con gravity center (ejemplo que quieres)
            center_crop: `${baseUrl}/ar_0.675,g_center,w_405,f_auto/${cleanPublicId}`,
            
            // 3. Solo formato auto (mínimo)
            simple_auto: `${baseUrl}/f_auto/${cleanPublicId}`,
            
            // 4. Con quality auto explícito
            quality_auto: `${baseUrl}/q_auto,f_auto/${cleanPublicId}`,
            
            // 5. Original sin transformaciones
            original: `${baseUrl}/${cleanPublicId}`,
            
            // 6. Formato Stremio con fill (alternativa)
            stremio_fill: `${baseUrl}/ar_0.675,c_fill,g_auto,w_405,q_auto,f_auto/${cleanPublicId}`,
            
            // 7. Responsive (width auto)
            responsive: `${baseUrl}/w_auto,q_auto,f_auto/${cleanPublicId}`
          };

          // URL principal optimizada para Stremio
          const stremioUrl = formats.stremio_optimized;
          
          // URL original (Cloudinary oficial)
          const originalUrl = cloudinary.url(result.public_id, {
            secure: true,
            resource_type: "image"
          });

          console.log('✅ Upload exitoso:');
          console.log(`   Public ID: ${result.public_id}`);
          console.log(`   Stremio URL: ${stremioUrl}`);
          console.log('   📋 Otros formatos disponibles:');
          Object.entries(formats).forEach(([key, url]) => {
            console.log(`     ${key}: ${url}`);
          });

          resolve({
            success: true,
            url: stremioUrl,                    // Principal para Stremio
            originalUrl: originalUrl,           // Cloudinary oficial
            formats: formats,                   // ← TODOS los formatos
            public_id: result.public_id,
            folder: folder,
            filename: filename,
            size: result.bytes,
            width: result.width,
            height: result.height,
            format: result.format || extension
          });
        }
      }
    );
    
    stream.end(buffer);
  });
}

module.exports = { uploadImageCloudinary };
