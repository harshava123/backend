const express = require('express');
const Joi = require('joi');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Validation schemas
const sendOtpSchema = Joi.object({
  phone: Joi.string().pattern(/^\+[1-9]\d{1,14}$/).required()
});

const verifyOtpSchema = Joi.object({
  phone: Joi.string().pattern(/^\+[1-9]\d{1,14}$/).required(),
  otp: Joi.string().length(6).required()
});

const registerSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().pattern(/^\+[1-9]\d{1,14}$/).required(),
  storeName: Joi.string().min(2).max(100).required(),
  address: Joi.string().min(10).required(),
  language: Joi.string().default('English'),
  gstNumber: Joi.string().allow(''),
  role: Joi.string().valid('vendor', 'customer').default('customer')
});

// Generate OTP (for development - in production use Twilio)
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP
router.post('/send-otp', async (req, res) => {
  try {
    const { error, value } = sendOtpSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { phone } = value;
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in database
    const { error: otpError } = await supabase
      .from('otp_verifications')
      .upsert({
        phone,
        otp,
        expires_at: expiresAt.toISOString(),
        is_used: false
      });

    if (otpError) {
      console.error('OTP storage error:', otpError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP'
      });
    }

    // In production, send OTP via Twilio
    console.log(`📱 OTP for ${phone}: ${otp}`);

    res.json({
      success: true,
      message: 'OTP sent successfully',
      // For development only - remove in production
      otp: process.env.NODE_ENV === 'development' ? otp : undefined
    });

  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Verify OTP and Login/Register
router.post('/verify-otp', async (req, res) => {
  try {
    const { error, value } = verifyOtpSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { phone, otp } = value;

    // Verify OTP
    const { data: otpData, error: otpError } = await supabase
      .from('otp_verifications')
      .select('*')
      .eq('phone', phone)
      .eq('otp', otp)
      .eq('is_used', false)
      .gte('expires_at', new Date().toISOString())
      .single();

    if (otpError || !otpData) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Mark OTP as used
    await supabase
      .from('otp_verifications')
      .update({ is_used: true })
      .eq('id', otpData.id);

    // Check if user exists
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('phone', phone)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      console.error('User check error:', userError);
      return res.status(500).json({
        success: false,
        message: 'Database error'
      });
    }

    if (!user) {
      // User doesn't exist - they need to register
      return res.json({
        success: true,
        message: 'OTP verified. Please complete registration.',
        requiresRegistration: true,
        phone
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          avatar: user.avatar,
          isVerified: user.is_verified
        }
      }
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { name, email, phone, storeName, address, language, gstNumber, role } = value;

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    // Check if email is already taken
    const { data: existingEmail } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Create new user
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        name,
        email,
        phone,
        role,
        is_verified: true
      })
      .select()
      .single();

    if (createError) {
      console.error('User creation error:', createError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create user'
      });
    }

    // If vendor, create vendor profile
    if (role === 'vendor') {
      const { error: vendorError } = await supabase
        .from('vendor_profiles')
        .insert({
          user_id: newUser.id,
          store_name: storeName,
          address,
          language,
          gst_number: gstNumber,
          approval_status: 'pending'
        });

      if (vendorError) {
        console.error('Vendor profile creation error:', vendorError);
        // Don't fail the registration, just log the error
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser.id, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        token,
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          phone: newUser.phone,
          role: newUser.role,
          avatar: newUser.avatar,
          isVerified: newUser.is_verified
        }
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get vendor profile if vendor
    let vendorProfile = null;
    if (user.role === 'vendor') {
      const { data: profile } = await supabase
        .from('vendor_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();
      vendorProfile = profile;
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          avatar: user.avatar,
          isVerified: user.is_verified,
          createdAt: user.created_at
        },
        vendorProfile
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Logout
router.post('/logout', authenticateToken, (req, res) => {
  // In a stateless JWT system, logout is handled client-side
  // You could implement a blacklist here if needed
  res.json({
    success: true,
    message: 'Logout successful'
  });
});

module.exports = router;
