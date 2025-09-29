const express = require('express');
const bcrypt = require('bcryptjs');
const Joi = require('joi');
const { supabase } = require('../config/database');

const router = express.Router();

// Validation schemas
const adminLoginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required()
});

// Admin login
router.post('/login', async (req, res) => {
  try {
    const { error, value } = adminLoginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { email, password } = value;

    // Check if it's the admin user in database
    if (email === 'Admin@gmail.com' && password === 'Admin@12') {
      // Verify the admin user exists in database
      const { data: adminUser, error: userError } = await supabase
        .from('users')
        .select('id, phone, role, is_verified')
        .eq('phone', 'Admin@gmail.com')
        .eq('role', 'admin') // Admin is now stored as admin role
        .single();

      if (userError || !adminUser) {
        console.error('Admin user not found in database:', userError);
        return res.status(401).json({
          success: false,
          message: 'Admin user not found in database'
        });
      }

      // Create a simple admin session token
      const adminToken = `admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      res.json({
        success: true,
        message: 'Admin login successful',
        data: {
          token: adminToken,
          user: {
            id: adminUser.id,
            email: 'Admin@gmail.com',
            role: 'admin',
            name: 'System Administrator'
          }
        }
      });
    } else {
      res.status(401).json({
        success: false,
        message: 'Invalid admin credentials'
      });
    }

  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Verify admin token (middleware)
const verifyAdminToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Admin token required'
    });
  }

  // Simple token validation (in production, use proper JWT)
  if (token.startsWith('admin_')) {
    req.admin = {
      email: 'Admin@gmail.com',
      role: 'admin'
    };
    next();
  } else {
    res.status(401).json({
      success: false,
      message: 'Invalid admin token'
    });
  }
};

// Admin profile
router.get('/profile', verifyAdminToken, (req, res) => {
  res.json({
    success: true,
    data: {
      email: req.admin.email,
      role: req.admin.role,
      name: 'System Administrator'
    }
  });
});

// Admin logout
router.post('/logout', verifyAdminToken, (req, res) => {
  res.json({
    success: true,
    message: 'Admin logged out successfully'
  });
});

// Export the middleware for use in other routes
router.verifyAdminToken = verifyAdminToken;

module.exports = router;
