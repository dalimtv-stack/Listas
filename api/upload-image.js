// api/upload-image.js
'use strict';

const { put } = require('@vercel/blob');
const formidable = require('formidable');
const fs = require('fs');

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    let fields, files;
    const uploadedFilepaths = [];
    const form = formidable({
      maxFileSize: 4 * 1024 * 1024, // 4MB safe limit (under Vercel's 4.5MB)
      keepExtensions: true,
      multiples: false,
      filter: ({ mimetype }) => mimetype?.startsWith('image/') ?? false,
    });

    try {
      [fields, files] = await form.parse(req);
      const file = files.file?.[0];
      if (Array.isArray(files.file)) uploadedFilepaths.push(...files.file.map(f => f.filepath));
      else if (file) uploadedFilepaths.push(file.filepath);

      const folder = fields.folder?.[0];
      if (!file) {
        return res.status(400).json({ error: 'No image file received', type: 'NO_FILE' });
      }
      if (!folder || !['plantillas', 'Canales'].includes(folder)) {
        return res.status(400).json({ error: 'Invalid folder: use "plantillas" or "Canales"', type: 'INVALID_FOLDER' });
      }

      const originalName = file.originalFilename || `${Date.now()}.png`;
      const blobName = `${folder}/${originalName}`;

      const buffer = await fs.promises.readFile(file.filepath);
      if (buffer.length === 0) {
        throw new Error('Empty file');
      }

      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        throw new Error('BLOB_READ_WRITE_TOKEN missing');
      }

      console.log(`Uploading ${originalName} (${(buffer.length / 1024).toFixed(1)} KB) to ${blobName}`);

      const result = await put(blobName, buffer, {
        access: 'public',
        contentType: file.mimetype || 'image/png',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false, // Keep original name
      });

      if (!result.url) {
        throw new Error('No URL returned from Blob');
      }

      res.setHeader('Content-Type', 'application/json');
      res.json({
        success: true,
        url: result.url,
        blobName,
        folder,
        filename: originalName,
        size: buffer.length,
      });

    } catch (error) {
      console.error('[Upload Error]', error.message);
      let type = 'UNKNOWN_ERROR';
      let userMessage = error.message;

      if (error.message.includes('maxFileSize') || error.message.includes('File too large')) {
        type = 'FILE_TOO_LARGE';
        userMessage = 'File exceeds 4MB limit (Vercel Functions restriction)';
      } else if (error.message.includes('BLOB_READ_WRITE_TOKEN')) {
        type = 'CONFIG_ERROR';
        userMessage = 'Vercel Blob token not configured';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        type = 'NETWORK_ERROR';
      } else if (error.message.includes('permission') || error.message.includes('access denied')) {
        type = 'PERMISSION_ERROR';
      } else if (error.message.includes('quota') || error.message.includes('limit')) {
        type = 'QUOTA_ERROR';
      }

      res.status(500).setHeader('Content-Type', 'application/json');
      res.json({
        error: userMessage,
        type,
        filename: files?.file?.[0]?.originalFilename,
        folder: fields?.folder?.[0],
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    } finally {
      uploadedFilepaths.forEach((filepath) => {
        fs.unlink(filepath, (err) => {
          if (err) console.warn('[Cleanup Warn]', filepath, err.message);
        });
      });
    }
    return;
  }

  // HTML interface (same as before, but update MAX_SIZE and warning)
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`
    <!DOCTYPE html>
    <!-- Your HTML here, but change:
    const MAX_SIZE = 4 * 1024 * 1024; // 4MB
    And in body: <p><strong>Máximo 4MB por imagen (límite de Vercel)</strong></p>
    In handleFiles: if (currentFile.size > MAX_SIZE) { show error with 4MB }
    Progress and other JS same. Use FormData for POST to /upload-image
    -->
  `); // Paste the full HTML from previous, with MAX_SIZE update
};
