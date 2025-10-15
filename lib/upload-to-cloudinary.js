// lib/upload-to-cloudinary.js - CONTROL EXACTO CON STRING
'use strict';

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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
          // ✅ STRING DIRECTO - ORDEN EXACTO
          const transformationString = "ar_0.675,b_auto,c_pad,w_405,q_auto,f_auto";
          
          const stremioUrl = cloudinary.url(result.public_id, {
            transformation: transformationString,  // ← CONTROL TOTAL
            secure: true,
            resource_type: "image"
          });

          const originalUrl = cloudinary.url(result.public_id, {
            secure: true,
            resource_type: "image"
          });

          console.log('✅ Upload exitoso:');
          console.log(`   Public ID: ${result.public_id}`);
          console.log(`   Stremio URL: ${stremioUrl}`);
          console.log(`   Tamaño: ${result.bytes} bytes (${(result.bytes / 1024).toFixed(1)} KB)`);

          resolve({
            success: true,
            url: stremioUrl,
            originalUrl: originalUrl,
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
