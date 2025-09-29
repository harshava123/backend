const express = require('express');
const Joi = require('joi');
const { supabase } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Validation schemas
const addToCartSchema = Joi.object({
  product_id: Joi.string().uuid().required(),
  quantity: Joi.number().integer().min(1).required(),
  selected_size: Joi.string().allow(''),
  selected_color: Joi.string().allow('')
});

const updateCartSchema = Joi.object({
  quantity: Joi.number().integer().min(1).required()
});

// Get user's cart
router.get('/', authenticateToken, requireRole('customer'), async (req, res) => {
  try {
    const { data: cartItems, error } = await supabase
      .from('cart_items')
      .select(`
        id,
        quantity,
        selected_size,
        selected_color,
        created_at,
        products (
          id,
          name,
          price,
          mrp,
          discount_percentage,
          images,
          stock,
          status
        )
      `)
      .eq('customer_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Cart fetch error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch cart'
      });
    }

    // Calculate totals
    const total = cartItems.reduce((sum, item) => {
      return sum + (item.products.price * item.quantity);
    }, 0);

    const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

    res.json({
      success: true,
      data: {
        items: cartItems,
        total,
        itemCount
      }
    });

  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Add item to cart
router.post('/add', authenticateToken, requireRole('customer'), async (req, res) => {
  try {
    const { error, value } = addToCartSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { product_id, quantity, selected_size, selected_color } = value;

    // Check if product exists and is active
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, price, stock, status')
      .eq('id', product_id)
      .eq('status', 'active')
      .single();

    if (productError || !product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or unavailable'
      });
    }

    // Check stock availability
    if (product.stock < quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.stock} items available in stock`
      });
    }

    // Check if item already exists in cart
    const { data: existingItem, error: existingError } = await supabase
      .from('cart_items')
      .select('id, quantity')
      .eq('customer_id', req.user.id)
      .eq('product_id', product_id)
      .eq('selected_size', selected_size || null)
      .eq('selected_color', selected_color || null)
      .single();

    if (existingItem) {
      // Update quantity
      const newQuantity = existingItem.quantity + quantity;
      
      if (product.stock < newQuantity) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} items available in stock`
        });
      }

      const { error: updateError } = await supabase
        .from('cart_items')
        .update({ quantity: newQuantity })
        .eq('id', existingItem.id);

      if (updateError) {
        console.error('Cart update error:', updateError);
        return res.status(500).json({
          success: false,
          message: 'Failed to update cart'
        });
      }

      res.json({
        success: true,
        message: 'Item quantity updated in cart'
      });
    } else {
      // Add new item
      const { error: insertError } = await supabase
        .from('cart_items')
        .insert({
          customer_id: req.user.id,
          product_id,
          quantity,
          selected_size: selected_size || null,
          selected_color: selected_color || null
        });

      if (insertError) {
        console.error('Cart insert error:', insertError);
        return res.status(500).json({
          success: false,
          message: 'Failed to add item to cart'
        });
      }

      res.json({
        success: true,
        message: 'Item added to cart'
      });
    }

  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update cart item quantity
router.put('/:id', authenticateToken, requireRole('customer'), async (req, res) => {
  try {
    const { id } = req.params;
    const { error, value } = updateCartSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { quantity } = value;

    // Check if cart item exists and belongs to user
    const { data: cartItem, error: checkError } = await supabase
      .from('cart_items')
      .select(`
        id,
        products (
          stock
        )
      `)
      .eq('id', id)
      .eq('customer_id', req.user.id)
      .single();

    if (checkError || !cartItem) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }

    // Check stock availability
    if (cartItem.products.stock < quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${cartItem.products.stock} items available in stock`
      });
    }

    const { error: updateError } = await supabase
      .from('cart_items')
      .update({ quantity })
      .eq('id', id);

    if (updateError) {
      console.error('Cart update error:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update cart item'
      });
    }

    res.json({
      success: true,
      message: 'Cart item updated'
    });

  } catch (error) {
    console.error('Update cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Remove item from cart
router.delete('/:id', authenticateToken, requireRole('customer'), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if cart item exists and belongs to user
    const { data: cartItem, error: checkError } = await supabase
      .from('cart_items')
      .select('id')
      .eq('id', id)
      .eq('customer_id', req.user.id)
      .single();

    if (checkError || !cartItem) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }

    const { error: deleteError } = await supabase
      .from('cart_items')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Cart delete error:', deleteError);
      return res.status(500).json({
        success: false,
        message: 'Failed to remove cart item'
      });
    }

    res.json({
      success: true,
      message: 'Item removed from cart'
    });

  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Clear entire cart
router.delete('/', authenticateToken, requireRole('customer'), async (req, res) => {
  try {
    const { error } = await supabase
      .from('cart_items')
      .delete()
      .eq('customer_id', req.user.id);

    if (error) {
      console.error('Clear cart error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to clear cart'
      });
    }

    res.json({
      success: true,
      message: 'Cart cleared'
    });

  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
