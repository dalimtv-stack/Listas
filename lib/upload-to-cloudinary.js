// lib/upload-to-cloudinary.js - ORIGINAL SIN TRANSFORMACIONES
'use strict';

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadImageCloudinary(buffer, filename, folder = 'Canales') {
  if (!['plantillas', 'Canales', 'Posters'].includes(folder)) {
    throw new Error(`Invalid folder: ${folder}. Use 'plantillas', 'Canales', or 'Posters'`);
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
          
          // ✅ URL ORIGINAL - SIN NINGUNA TRANSFORMACIÓN
          const originalUrl = `https://res.cloudinary.com/${cloudName}/image/upload/${cleanPublicId}`;
          
          // ✅ MÚLTIPLES FORMATO CON TRANSFORMACIONES
          const formats = {
            stremio_optimized: `https://res.cloudinary.com/${cloudName}/image/upload/ar_0.675,b_auto,c_pad,w_405,q_auto,f_auto/${cleanPublicId}`,
            center_crop: `https://res.cloudinary.com/${cloudName}/image/upload/ar_0.675,g_center,w_405,f_auto/${cleanPublicId}`,
            simple_auto: `https://res.cloudinary.com/${cloudName}/image/upload/f_auto/${cleanPublicId}`,
            quality_auto: `https://res.cloudinary.com/${cloudName}/image/upload/q_auto,f_auto/${cleanPublicId}`,
            stremio_fill: `https://res.cloudinary.com/${cloudName}/image/upload/ar_0.675,c_fill,g_auto,w_405,q_auto,f_auto/${cleanPublicId}`,
            responsive: `https://res.cloudinary.com/${cloudName}/image/upload/w_auto,q_auto,f_auto/${cleanPublicId}`,
            high_quality: `https://res.cloudinary.com/${cloudName}/image/upload/q_90,f_auto/${cleanPublicId}`
          };

          // URL principal para Stremio
          const stremioUrl = formats.stremio_optimized;

          console.log('✅ Upload exitoso:');
          console.log(`   Public ID: ${result.public_id}`);
          console.log(`   Original: ${originalUrl}`);
          console.log(`   Stremio: ${stremioUrl}`);

          resolve({
            success: true,
            url: stremioUrl,           // ← Principal optimizada
            originalUrl: originalUrl,  // ← ORIGINAL SIN TRANSFORMACIONES
            formats: formats,          // ← Transformaciones adicionales
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
