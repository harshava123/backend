const express = require('express');
const Joi = require('joi');
const { supabase } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Validation schemas
const createOrderSchema = Joi.object({
  items: Joi.array().items(Joi.object({
    product_id: Joi.string().uuid().required(),
    quantity: Joi.number().integer().min(1).required(),
    price_at_order: Joi.number().positive().required()
  })).min(1).required(),
  shipping_address: Joi.object({
    name: Joi.string().required(),
    phone: Joi.string().required(),
    address: Joi.string().required(),
    city: Joi.string().required(),
    state: Joi.string().required(),
    pincode: Joi.string().required()
  }).required(),
  payment_method: Joi.string().valid('COD', 'CARD', 'UPI', 'WALLET').default('COD')
});

const updateOrderStatusSchema = Joi.object({
  status: Joi.string().valid('pending', 'confirmed', 'shipped', 'delivered', 'cancelled').required(),
  payment_status: Joi.string().valid('pending', 'paid', 'failed', 'refunded').optional()
});

// Create order (Customer)
router.post('/', authenticateToken, requireRole('customer'), async (req, res) => {
  try {
    const { error, value } = createOrderSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { items, shipping_address, payment_method } = value;

    // Calculate total amount
    const totalAmount = items.reduce((sum, item) => sum + (item.price_at_order * item.quantity), 0);

    // Get vendor_id from first product
    const { data: firstProduct, error: productError } = await supabase
      .from('products')
      .select('vendor_id')
      .eq('id', items[0].product_id)
      .single();

    if (productError || !firstProduct) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product'
      });
    }

    // Create order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_id: req.user.id,
        vendor_id: firstProduct.vendor_id,
        total_amount: totalAmount,
        shipping_address,
        payment_method,
        status: 'pending',
        payment_status: 'pending'
      })
      .select()
      .single();

    if (orderError) {
      console.error('Order creation error:', orderError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create order'
      });
    }

    // Create order items
    const orderItems = items.map(item => ({
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      price_at_order: item.price_at_order
    }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems);

    if (itemsError) {
      console.error('Order items creation error:', itemsError);
      // Rollback order
      await supabase.from('orders').delete().eq('id', order.id);
      return res.status(500).json({
        success: false,
        message: 'Failed to create order items'
      });
    }

    // Update product stock
    for (const item of items) {
      await supabase.rpc('decrement_product_stock', {
        product_id: item.product_id,
        quantity: item.quantity
      });
    }

    // Get complete order details
    const { data: completeOrder } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (
          id,
          quantity,
          price_at_order,
          products (
            id,
            name,
            images
          )
        )
      `)
      .eq('id', order.id)
      .single();

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: completeOrder
    });

  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get orders (Customer - own orders, Vendor - own orders)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const user = req.user;

    let query = supabase
      .from('orders')
      .select(`
        *,
        order_items (
          id,
          quantity,
          price_at_order,
          products (
            id,
            name,
            images
          )
        ),
        users!orders_customer_id_fkey (
          id,
          name,
          phone
        ),
        vendors:users!orders_vendor_id_fkey (
          id,
          name
        )
      `)
      .order('created_at', { ascending: false });

    // Filter by user role
    if (user.role === 'customer') {
      query = query.eq('customer_id', user.id);
    } else if (user.role === 'vendor') {
      query = query.eq('vendor_id', user.id);
    }

    // Filter by status
    if (status) {
      query = query.eq('status', status);
    }

    // Pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data: orders, error } = await query;

    if (error) {
      console.error('Orders fetch error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch orders'
      });
    }

    // Get total count
    let countQuery = supabase
      .from('orders')
      .select('*', { count: 'exact', head: true });

    if (user.role === 'customer') {
      countQuery = countQuery.eq('customer_id', user.id);
    } else if (user.role === 'vendor') {
      countQuery = countQuery.eq('vendor_id', user.id);
    }

    if (status) {
      countQuery = countQuery.eq('status', status);
    }

    const { count } = await countQuery;

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get single order
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (
          id,
          quantity,
          price_at_order,
          products (
            id,
            name,
            description,
            images,
            categories (
              name
            )
          )
        ),
        customer:users!orders_customer_id_fkey (
          id,
          name,
          email,
          phone
        ),
        vendor:users!orders_vendor_id_fkey (
          id,
          name,
          phone
        )
      `)
      .eq('id', id)
      .single();

    if (error || !order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user has access to this order
    if (user.role === 'customer' && order.customer_id !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (user.role === 'vendor' && order.vendor_id !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: order
    });

  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update order status (Vendor only)
router.put('/:id/status', authenticateToken, requireRole('vendor'), async (req, res) => {
  try {
    const { id } = req.params;
    const { error, value } = updateOrderStatusSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    // Check if order belongs to vendor
    const { data: existingOrder, error: checkError } = await supabase
      .from('orders')
      .select('vendor_id, status')
      .eq('id', id)
      .single();

    if (checkError || !existingOrder) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (existingOrder.vendor_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own orders'
      });
    }

    const updateData = { status: value.status };
    if (value.payment_status) {
      updateData.payment_status = value.payment_status;
    }

    const { data: order, error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        order_items (
          id,
          quantity,
          price_at_order,
          products (
            id,
            name,
            images
          )
        )
      `)
      .single();

    if (updateError) {
      console.error('Order update error:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update order'
      });
    }

    res.json({
      success: true,
      message: 'Order status updated successfully',
      data: order
    });

  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
