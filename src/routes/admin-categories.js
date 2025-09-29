const express = require('express');
const Joi = require('joi');
const { supabase } = require('../config/database');
const { verifyAdminToken } = require('./admin');

const router = express.Router();

// Validation schema
const createCategorySchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  description: Joi.string().allow(''),
  image: Joi.string().uri().allow('').allow(null)
});

// Get all categories (Admin view)
router.get('/', verifyAdminToken, async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from('categories')
      .select('*')
      .order('name');

    if (error) {
      console.error('Categories fetch error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch categories'
      });
    }

    res.json({
      success: true,
      data: categories
    });

  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Create category (Admin only)
router.post('/', verifyAdminToken, async (req, res) => {
  try {
    const { error, value } = createCategorySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    // Check if category name already exists
    const { data: existingCategory } = await supabase
      .from('categories')
      .select('id')
      .eq('name', value.name)
      .single();

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Category with this name already exists'
      });
    }

    const { data: category, error: createError } = await supabase
      .from('categories')
      .insert(value)
      .select()
      .single();

    if (createError) {
      console.error('Category creation error:', createError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create category'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: category
    });

  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update category (Admin only)
router.put('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🔍 Updating category with ID:', id);
    console.log('📝 Request body:', req.body);
    
    const { error, value } = createCategorySchema.validate(req.body);
    
    if (error) {
      console.error('❌ Validation error:', error.details[0].message);
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    console.log('✅ Validated data:', value);

    // Log image size for monitoring (database is now fixed to handle large images)
    if (value.image) {
      const imageSizeKB = Math.round(value.image.length / 1024);
      console.log(`📁 Image data size: ${imageSizeKB}KB`);
    }

    const { data: category, error: updateError } = await supabase
      .from('categories')
      .update(value)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Supabase update error:', updateError);
      
      // Provide specific error message for column size issues
      if (updateError.code === '22001' && updateError.message.includes('too long')) {
        const imageSizeKB = value.image ? Math.round(value.image.length / 1024) : 0;
        return res.status(400).json({
          success: false,
          message: `Image data is too large (${imageSizeKB}KB) for the database column. Please run the database fix SQL: ALTER TABLE categories ALTER COLUMN image TYPE TEXT;`,
          error: 'COLUMN_SIZE_EXCEEDED',
          imageSize: imageSizeKB,
          fixRequired: 'ALTER TABLE categories ALTER COLUMN image TYPE TEXT;'
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to update category',
        error: updateError.message
      });
    }

    if (!category) {
      console.error('❌ No category found with ID:', id);
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    console.log('✅ Category updated successfully:', category);
    res.json({
      success: true,
      message: 'Category updated successfully',
      data: category
    });

  } catch (error) {
    console.error('❌ Update category error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Delete category (Admin only)
router.delete('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if category exists
    const { data: category, error: checkError } = await supabase
      .from('categories')
      .select('id, name')
      .eq('id', id)
      .single();

    if (checkError || !category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check if category has products
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id')
      .eq('category_id', id)
      .limit(1);

    if (productsError) {
      console.error('Products check error:', productsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to check category usage'
      });
    }

    if (products && products.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete category that contains products. Please move or delete products first.'
      });
    }

    // Delete the category
    const { error: deleteError } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Category deletion error:', deleteError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete category'
      });
    }

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });

  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
