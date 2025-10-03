const express = require('express');
const path = require('path');
const AWS = require('aws-sdk');
const { authenticateToken } = require('../middleware/auth');
const { verifyAdminToken } = require('./admin');
const { uploadSingle, uploadMultiple, handleUploadError } = require('../middleware/upload');

const router = express.Router();

// Configure AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'ap-south-1'
});

const S3_BUCKET = process.env.AWS_S3_BUCKET || 'trullu-product-images';

// Helper function to upload file to AWS S3
const uploadToS3 = async (file, folder = 'uploads') => {
  try {
    const fileName = `${folder}/${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    
    const params = {
      Bucket: S3_BUCKET,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      // ACL removed - use bucket policy for public access instead
      CacheControl: 'max-age=31536000' // Cache for 1 year
    };

    const result = await s3.upload(params).promise();

    console.log(`✅ Uploaded to S3: ${result.Location}`);

    return {
      filename: fileName,
      originalname: file.originalname,
      size: file.size,
      url: result.Location,
      fullUrl: result.Location
    };
  } catch (error) {
    console.error('Upload to S3 failed:', error);
    throw new Error(`Failed to upload to S3: ${error.message}`);
  }
};

// Note: All uploads now use AWS S3 instead of local filesystem or Supabase Storage

// Upload single image (for profile, category, etc.)
router.post('/single', authenticateToken, (req, res, next) => {
  const upload = uploadSingle('image');
  
  upload(req, res, async (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    try {
      // Upload to AWS S3
      const uploadedFile = await uploadToS3(req.file, 'images');

      res.json({
        success: true,
        message: 'File uploaded successfully to S3',
        data: uploadedFile
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to upload file'
      });
    }
  });
});

// Upload multiple images (for products)
router.post('/multiple', authenticateToken, (req, res, next) => {
  const upload = uploadMultiple('images', 10);
  
  upload(req, res, async (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    try {
      // Upload all files to AWS S3
      const uploadPromises = req.files.map(file => uploadToS3(file, 'products'));
      const uploadedFiles = await Promise.all(uploadPromises);

      res.json({
        success: true,
        message: 'Files uploaded successfully to S3',
        data: uploadedFiles
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to upload files'
      });
    }
  });
});

// Upload product images with specific field names
router.post('/product', authenticateToken, (req, res, next) => {
  const upload = uploadMultiple('product_images', 10);
  
  upload(req, res, async (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No product images uploaded'
      });
    }

    try {
      // Upload all files to AWS S3
      const uploadPromises = req.files.map(file => uploadToS3(file, 'products'));
      const uploadedFiles = await Promise.all(uploadPromises);

      res.json({
        success: true,
        message: 'Product images uploaded successfully to S3',
        data: uploadedFiles
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to upload product images'
      });
    }
  });
});

// Upload category image (vendor)
router.post('/category', authenticateToken, (req, res, next) => {
  const upload = uploadSingle('category_image');
  
  upload(req, res, async (err) => {
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
      // Upload to AWS S3
      const uploadedFile = await uploadToS3(req.file, 'categories');

      res.json({
        success: true,
        message: 'Category image uploaded successfully to S3',
        data: uploadedFile
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to upload category image'
      });
    }
  });
});

// Upload category image (admin) - Uses AWS S3 + returns base64 for immediate preview
router.post('/admin/category', verifyAdminToken, (req, res, next) => {
  const upload = uploadSingle('category_image');
  
  upload(req, res, async (err) => {
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
      // Upload to AWS S3
      const uploadedFile = await uploadToS3(req.file, 'categories');
      
      // Also generate base64 for immediate preview (from buffer)
      const base64Data = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      
      res.json({
        success: true,
        message: 'Category image uploaded successfully to S3',
        data: {
          ...uploadedFile,
          mimeType: req.file.mimetype,
          base64: base64Data,
          imageData: uploadedFile.fullUrl // Use S3 URL as primary
        }
      });
    } catch (error) {
      console.error('Error processing image:', error);
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
  
  upload(req, res, async (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No profile image uploaded'
      });
    }

    try {
      // Upload to AWS S3
      const uploadedFile = await uploadToS3(req.file, 'profiles');

      res.json({
        success: true,
        message: 'Profile image uploaded successfully to S3',
        data: uploadedFile
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to upload profile image'
      });
    }
  });
});

// Delete uploaded file from AWS S3
router.delete('/:filename', authenticateToken, async (req, res) => {
  const filename = req.params.filename;

  try {
    const params = {
      Bucket: S3_BUCKET,
      Key: filename
    };

    await s3.deleteObject(params).promise();

    console.log(`✅ Deleted from S3: ${filename}`);

    res.json({
      success: true,
      message: 'File deleted successfully from S3'
    });
  } catch (error) {
    console.error('S3 deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete file from S3'
    });
  }
});

module.exports = router;
