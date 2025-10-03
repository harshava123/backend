const express = require('express');
const Joi = require('joi');
const { supabase } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Validation schemas
const createProductSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  description: Joi.string().allow(''),
  category_id: Joi.string().uuid().required(),
  price: Joi.number().positive().required(),
  discount_price: Joi.number().positive().allow(null),
  stock_quantity: Joi.number().integer().min(0).default(0),
  min_order_quantity: Joi.number().integer().min(1).default(1),
  images: Joi.array().items(Joi.string()).default([]),
  sizes: Joi.array().items(Joi.string()).default([]),
  colors: Joi.array().items(Joi.string()).default([]),
  is_featured: Joi.boolean().default(false)
});

const updateProductSchema = Joi.object({
  name: Joi.string().min(2).max(100),
  description: Joi.string().allow(''),
  category_id: Joi.string().uuid(),
  price: Joi.number().positive(),
  discount_price: Joi.number().positive().allow(null),
  stock_quantity: Joi.number().integer().min(0),
  min_order_quantity: Joi.number().integer().min(1),
  images: Joi.array().items(Joi.string()),
  sizes: Joi.array().items(Joi.string()),
  colors: Joi.array().items(Joi.string()),
  is_active: Joi.boolean(),
  is_featured: Joi.boolean()
});

// Get all products (for Bazar Story)
router.get('/', async (req, res) => {
  try {
    const { category, featured, search, page = 1, limit = 20 } = req.query;
    
    let query = supabase
      .from('products')
      .select(`
        *,
        categories (
          id,
          name
        )
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    // Apply filters
    if (category) {
      query = query.eq('category_id', category);
    }
    
    if (featured === 'true') {
      query = query.eq('is_featured', true);
    }
    
    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data: products, error } = await query;

    if (error) {
      console.error('Products fetch error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch products'
      });
    }

    // Get total count for pagination
    const { count } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    res.json({
      success: true,
      data: products,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get single product
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: product, error } = await supabase
      .from('products')
      .select(`
        *,
        categories (
          id,
          name,
          description
        )
      `)
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error || !product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      data: product
    });

  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Create product (Vendor only)
router.post('/', authenticateToken, requireRole('vendor'), async (req, res) => {
  try {
    const { error, value } = createProductSchema.validate(req.body);
    if (error) {
      console.error('❌ Validation error:', error.details[0].message);
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    // Get vendor profile ID from user ID
    const { data: vendorProfile, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    if (vendorError || !vendorProfile) {
      console.error('Vendor profile not found:', vendorError);
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found. Please complete your vendor profile setup.'
      });
    }

    const productData = {
      ...value,
      vendor_id: vendorProfile.id
    };

    const { data: product, error: createError } = await supabase
      .from('products')
      .insert(productData)
      .select(`
        *,
        categories (
          id,
          name
        )
      `)
      .single();

    if (createError) {
      console.error('Product creation error:', createError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create product',
        error: createError.message || 'Unknown database error'
      });
    }

    console.log('✅ Product created successfully:', product.name);
    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product
    });

  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update product (Vendor only)
router.put('/:id', authenticateToken, requireRole('vendor'), async (req, res) => {
  try {
    const { id } = req.params;
    const { error, value } = updateProductSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    // Resolve current vendor profile id for this user
    const { data: vendorProfile, error: vendorErr } = await supabase
      .from('vendor_profiles')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    if (vendorErr || !vendorProfile) {
      return res.status(404).json({ success: false, message: 'Vendor profile not found' });
    }

    // Check if product belongs to this vendor
    const { data: existingProduct, error: checkError } = await supabase
      .from('products')
      .select('vendor_id')
      .eq('id', id)
      .single();

    if (checkError || !existingProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (existingProduct.vendor_id !== vendorProfile.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own products'
      });
    }

    const { data: product, error: updateError } = await supabase
      .from('products')
      .update(value)
      .eq('id', id)
      .select(`
        *,
        categories (
          id,
          name
        )
      `)
      .single();

    if (updateError) {
      console.error('Product update error:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update product'
      });
    }

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: product
    });

  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete product (Vendor only)
router.delete('/:id', authenticateToken, requireRole('vendor'), async (req, res) => {
  try {
    const { id } = req.params;

    // Resolve current vendor profile id for this user
    const { data: vendorProfile, error: vendorErr } = await supabase
      .from('vendor_profiles')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    if (vendorErr || !vendorProfile) {
      return res.status(404).json({ success: false, message: 'Vendor profile not found' });
    }

    // Check if product belongs to this vendor
    const { data: existingProduct, error: checkError } = await supabase
      .from('products')
      .select('vendor_id')
      .eq('id', id)
      .single();

    if (checkError || !existingProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (existingProduct.vendor_id !== vendorProfile.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own products'
      });
    }

    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Product deletion error:', deleteError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete product'
      });
    }

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });

  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get vendor's products
router.get('/vendor/my-products', authenticateToken, requireRole('vendor'), async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;

    let query = supabase
      .from('products')
      .select(`
        *,
        categories (
          id,
          name
        )
      `)
      .eq('vendor_id', req.user.id)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    // Pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data: products, error } = await query;

    if (error) {
      console.error('Vendor products fetch error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch products'
      });
    }

    res.json({
      success: true,
      data: products
    });

  } catch (error) {
    console.error('Get vendor products error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get vendor's products in a specific category
router.get('/vendor/by-category/:categoryId', authenticateToken, requireRole('vendor'), async (req, res) => {
  try {
    const { categoryId } = req.params;

    // Resolve current vendor profile id
    const { data: vendorProfile, error: vendorErr } = await supabase
      .from('vendor_profiles')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    if (vendorErr || !vendorProfile) {
      return res.status(404).json({ success: false, message: 'Vendor profile not found' });
    }

    const { data: products, error } = await supabase
      .from('products')
      .select(`*, categories(id,name)`) 
      .eq('vendor_id', vendorProfile.id)
      .eq('category_id', categoryId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json({ success: true, data: products });
  } catch (error) {
    console.error('Get vendor products by category error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

module.exports = router;
