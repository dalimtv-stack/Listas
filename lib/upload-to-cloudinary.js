// lib/upload-to-cloudinary.js
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
        format: 'auto',     // WebP/AVIF automático
        quality: 'auto',    // Calidad optimizada
        overwrite: true,    // Sobrescribe si existe
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary error:', error);
          reject(error);
        } else {
          resolve({
            success: true,
            url: result.secure_url,
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
