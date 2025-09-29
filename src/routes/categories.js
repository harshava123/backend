const express = require('express');
const Joi = require('joi');
const { supabase } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Validation schema
const createCategorySchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  description: Joi.string().allow(''),
  image: Joi.string().uri().allow('').allow(null)
});

// Get all categories
router.get('/', async (req, res) => {
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

// Get single category with products
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;

    // Get category details
    const { data: category, error: categoryError } = await supabase
      .from('categories')
      .select('*')
      .eq('id', id)
      .single();

    if (categoryError || !category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Get products in this category
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('*')
      .eq('category_id', id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (productsError) {
      console.error('Products fetch error:', productsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch products'
      });
    }

    // Get total count
    const { count } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', id)
      .eq('is_active', true);

    res.json({
      success: true,
      data: {
        category,
        products,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get category error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Create category - REMOVED: Only admins can create categories via /api/admin/categories

// Update category
router.put('/:id', authenticateToken, requireRole(['vendor']), async (req, res) => {
  try {
    const { id } = req.params;
    const { error, value } = createCategorySchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { data: category, error: updateError } = await supabase
      .from('categories')
      .update(value)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('Category update error:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update category'
      });
    }

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: category
    });

  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete category (Admin and vendors can delete)
router.delete('/:id', authenticateToken, requireRole(['vendor']), async (req, res) => {
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
