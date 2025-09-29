const express = require('express');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');
const { verifyAdminToken } = require('./admin');
const { uploadSingle, uploadMultiple, handleUploadError } = require('../middleware/upload');

const router = express.Router();

// Helper function to convert file to base64 with compression
const convertFileToBase64 = (filePath, mimeType) => {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const base64String = fileBuffer.toString('base64');
    
    // Log file size for debugging
    const fileSizeKB = Math.round(fileBuffer.length / 1024);
    const base64SizeKB = Math.round(base64String.length / 1024);
    console.log(`📁 File size: ${fileSizeKB}KB, Base64 size: ${base64SizeKB}KB`);
    
    // If base64 is too large (>100KB), return a warning
    if (base64String.length > 100000) {
      console.warn(`⚠️ Large base64 string: ${base64SizeKB}KB. Consider image compression.`);
    }
    
    return `data:${mimeType};base64,${base64String}`;
  } catch (error) {
    console.error('Error converting file to base64:', error);
    throw new Error('Failed to convert file to base64');
  }
};

// Upload single image (for profile, category, etc.)
router.post('/single', authenticateToken, (req, res, next) => {
  const upload = uploadSingle('image');
  
  upload(req, res, (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Return file information
    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        url: `/uploads/${req.file.filename}`,
        fullUrl: `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
      }
    });
  });
});

// Upload multiple images (for products)
router.post('/multiple', authenticateToken, (req, res, next) => {
  const upload = uploadMultiple('images', 10);
  
  upload(req, res, (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    // Process uploaded files
    const uploadedFiles = req.files.map(file => ({
      filename: file.filename,
      originalname: file.originalname,
      size: file.size,
      url: `/uploads/${file.filename}`,
      fullUrl: `${req.protocol}://${req.get('host')}/uploads/${file.filename}`
    }));

    res.json({
      success: true,
      message: 'Files uploaded successfully',
      data: uploadedFiles
    });
  });
});

// Upload product images with specific field names
router.post('/product', authenticateToken, (req, res, next) => {
  const upload = uploadMultiple('product_images', 10);
  
  upload(req, res, (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No product images uploaded'
      });
    }

    // Process uploaded files
    const uploadedFiles = req.files.map(file => ({
      filename: file.filename,
      originalname: file.originalname,
      size: file.size,
      url: `/uploads/${file.filename}`,
      fullUrl: `${req.protocol}://${req.get('host')}/uploads/${file.filename}`
    }));

    res.json({
      success: true,
      message: 'Product images uploaded successfully',
      data: uploadedFiles
    });
  });
});

// Upload category image (vendor)
router.post('/category', authenticateToken, (req, res, next) => {
  const upload = uploadSingle('category_image');
  
  upload(req, res, (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No category image uploaded'
      });
    }

    res.json({
      success: true,
      message: 'Category image uploaded successfully',
      data: {
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        url: `/uploads/${req.file.filename}`,
        fullUrl: `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
      }
    });
  });
});

// Upload category image (admin) - Returns base64
router.post('/admin/category', verifyAdminToken, (req, res, next) => {
  const upload = uploadSingle('category_image');
  
  upload(req, res, (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No category image uploaded'
      });
    }

    try {
      // Convert file to base64
      const base64Data = convertFileToBase64(req.file.path, req.file.mimetype);
      
      // Clean up the temporary file
      fs.unlinkSync(req.file.path);
      
      res.json({
        success: true,
        message: 'Category image uploaded successfully',
        data: {
          filename: req.file.filename,
          originalname: req.file.originalname,
          size: req.file.size,
          mimeType: req.file.mimetype,
          base64: base64Data,
          // Keep URL for backward compatibility if needed
          url: `/uploads/${req.file.filename}`,
          fullUrl: `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
        }
      });
    } catch (error) {
      console.error('Error processing image:', error);
      // Clean up the temporary file if base64 conversion fails
      if (req.file && req.file.path) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({
        success: false,
        message: 'Failed to process image'
      });
    }
  });
});

// Upload profile image
router.post('/profile', authenticateToken, (req, res, next) => {
  const upload = uploadSingle('profile_image');
  
  upload(req, res, (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No profile image uploaded'
      });
    }

    res.json({
      success: true,
      message: 'Profile image uploaded successfully',
      data: {
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        url: `/uploads/${req.file.filename}`,
        fullUrl: `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
      }
    });
  });
});

// Delete uploaded file
router.delete('/:filename', authenticateToken, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, '../../uploads', filename);

  // Check if file exists
  const fs = require('fs');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      message: 'File not found'
    });
  }

  // Delete file
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('File deletion error:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete file'
      });
    }

    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  });
});

module.exports = router;
