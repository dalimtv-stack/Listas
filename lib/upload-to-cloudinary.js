// lib/upload-to-cloudinary.js - MÉTODO OFICIAL CLOUDINARY
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

  // ✅ Extraer nombre y extensión
  const extension = filename.split('.').pop().toLowerCase();
  const publicId = filename.replace(`.${extension}`, ''); // "Hollywood.jpg" → "Hollywood"
  
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { 
        folder,
        public_id: publicId, // ← NOMBRE PERSONALIZADO
        resource_type: 'image',
        overwrite: true,
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', error);
          reject(error);
        } else {
          // ✅ MÉTODO OFICIAL: cloudinary.image() para transformations
          const stremioImage = cloudinary.image(result.public_id, {
            transformation: [
              { width: 405, height: 600, crop: "fill" }, // Proporción Stremio 0.675:1
              { quality: "auto" },
              { fetch_format: "auto" }
            ]
          });
          
          // Extraer la URL del HTML generado
          const stremioUrl = stremioImage.match(/src="([^"]+)"/)[1];
          
          console.log('✅ Public ID:', result.public_id);
          console.log('✅ Stremio URL:', stremioUrl);
          
          resolve({
            success: true,
            url: stremioUrl, // ← URL transformada oficial
            public_id: result.public_id,
            folder,
            filename: filename, // ← NOMBRE ORIGINAL
            size: result.bytes,
            width: result.width,
            height: result.height,
            original_public_id: result.public_id // Para debug
          });
        }
      }
    );
    stream.end(buffer);
  });
}

module.exports = { uploadImageCloudinary };
