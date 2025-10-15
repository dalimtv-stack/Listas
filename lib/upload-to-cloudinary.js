// lib/upload-to-cloudinary.js
const cloudinary = require('cloudinary').v2;

async function uploadImageCloudinary(buffer, filename, folder) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', format: 'auto' },
      (error, result) => error ? reject(error) : resolve(result.secure_url)
    ).end(buffer);
  });
}

module.exports = { uploadImageCloudinary };
