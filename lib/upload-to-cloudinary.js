// lib/upload-to-cloudinary.js - FIX NOMBRE Y URL STREMIO
'use strict';

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadImageCloudinary(buffer, filename, folder = 'plantillas') {
  if (!['plantillas', 'Canales'].includes(folder)) {
    throw new Error(`Invalid folder: ${folder}`);
  }

  // ✅ Extraer extensión del filename
  const extension = filename.split('.').pop().toLowerCase();
  
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { 
        folder,
        public_id: filename.replace(`.${extension}`, ''), // ← USA EL NOMBRE SIN EXTENSIÓN
        resource_type: 'image',
        overwrite: true,
        format: extension, // ← MANTIENE EXTENSIÓN ORIGINAL
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary error:', error);
          reject(error);
        } else {
          // ✅ URL STREMIO: w_405/h_600 + q_auto/f_auto
          const stremioUrl = cloudinary.url(result.public_id, {
            transformation: [
              { width: 405, height: 600, crop: 'fill' }, // Proporción Stremio 0.675:1
              { quality: 'auto' },
              { fetch_format: 'auto' }
            ],
            resource_type: 'image',
          });
          
          console.log('✅ Cloudinary public_id:', result.public_id);
          console.log('✅ Stremio URL:', stremioUrl);
          
          resolve({
            success: true,
            url: stremioUrl, // ← URL OPTIMIZADA PARA STREMIO
            originalUrl: cloudinary.url(result.public_id, { resource_type: 'image' }), // URL original
            public_id: result.public_id,
            folder,
            filename: `${result.public_id}.${extension}`,
            size: result.bytes,
            width: result.width,
            height: result.height,
          });
        }
      }
    );
    stream.end(buffer);
  });
}

module.exports = { uploadImageCloudinary };
