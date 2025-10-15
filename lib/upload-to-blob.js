// lib/upload-to-blob.js
'use strict';

const { put } = require('@vercel/blob');
const fs = require('fs').promises;

async function uploadImageBlob(buffer, filename, folder) {
  if (!folder || !['plantillas', 'Canales'].includes(folder)) {
    throw new Error(`Invalid folder: ${folder}. Use 'plantillas' or 'Canales'`);
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN missing');
  }

  const blobName = `${folder}/${filename}`;
  
  const result = await put(blobName, buffer, {
    access: 'public',
    contentType: 'image/jpeg', // o detecta del buffer
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
  });

  if (!result.url) {
    throw new Error('Upload failed: no URL returned');
  }

  return {
    success: true,
    url: result.url,
    blobName,
    folder,
    filename,
    size: buffer.length,
  };
}

module.exports = { uploadImageBlob };
