// lib/upload-to-cloudinary.js - CORREGIDO
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

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { 
        folder,
        resource_type: 'image',
        overwrite: true,
        // ❌ ELIMINADO: format: 'auto', quality: 'auto' (causa error)
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary error:', error);
          reject(error);
        } else {
          // ✅ URL optimizada MANUAL en response
          const optimizedUrl = cloudinary.url(result.public_id, {
            fetch_format: 'auto',
            quality: 'auto',
            resource_type: 'image',
          });
          
          resolve({
            success: true,
            url: optimizedUrl, // URL con f_auto,q_auto
            public_id: result.public_id,
            folder,
            filename,
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
