const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

// Initialize Supabase client with service role key
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://umsznqdichlqsozobqsr.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtc3pucWRpY2hscXNvem9icXNyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTA1MzI4MCwiZXhwIjoyMDc0NjI5MjgwfQ.1a8uibaozFbHZ6WoN0txTJi5IWUVSI8JBNssKbuJWGU'
);

// Register endpoint
router.post('/', async (req, res) => {
  console.log('🚀 REGISTRATION REQUEST RECEIVED');
  console.log('📝 Request body:', req.body);
  
  try {
    const { name, email, password, storeName, address, gstNumber, language, shopDocuments, idProof } = req.body;
    console.log('📋 Extracted data:', { name, email, storeName, address, gstNumber, language, shopDocuments, idProof });

    // Validation
    if (!name || !email || !password || !storeName || !address) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Step 1: Create user with Supabase Auth
    console.log('🔐 Creating user with Supabase Auth...');
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      user_metadata: {
        name: name,
        role: 'vendor'
      },
      email_confirm: true // Auto-confirm email
    });

    if (authError) {
      console.log('❌ Supabase Auth creation failed:', authError);
      return res.status(400).json({
        success: false,
        message: authError.message
      });
    }

    if (!authData.user) {
      console.log('❌ No user returned from Supabase Auth');
      return res.status(400).json({
        success: false,
        message: 'Failed to create user account'
      });
    }

    console.log('✅ Supabase Auth user created:', {
      id: authData.user.id,
      email: authData.user.email
    });

    // Step 2: Create user record in users table
    console.log('👤 Creating user record in users table...');
    const userInsertData = {
      id: authData.user.id,
      phone: email.substring(0, 15), // Truncate email to fit VARCHAR(15)
      role: 'vendor',
      is_verified: true,
      created_at: new Date().toISOString()
    };
    console.log('📝 User insert data:', userInsertData);

    const { data: userInsertResult, error: userError } = await supabase
      .from('users')
      .insert(userInsertData)
      .select();

    if (userError) {
      console.error('❌ User creation error:', userError);
      console.error('❌ User creation error details:', JSON.stringify(userError, null, 2));
    } else {
      console.log('✅ User record created successfully:', userInsertResult);
    }

    // Step 3: Create vendor profile
    console.log('🏪 Creating vendor profile...');
    const vendorInsertData = {
      user_id: authData.user.id,
      business_name: storeName,
      address: address,
      gst_number: gstNumber || null,
      language: language || 'English',
      shop_documents: shopDocuments || [],
      id_proof: idProof || null
    };
    console.log('📝 Vendor insert data:', vendorInsertData);

    const { data: vendorInsertResult, error: vendorError } = await supabase
      .from('vendor_profiles')
      .insert(vendorInsertData)
      .select();

    if (vendorError) {
      console.error('❌ Vendor profile creation error:', vendorError);
      console.error('❌ Vendor profile creation error details:', JSON.stringify(vendorError, null, 2));
    } else {
      console.log('✅ Vendor profile created successfully:', vendorInsertResult);
    }

    console.log('🎉 Registration completed successfully');

    res.json({
      success: true,
      message: 'Registration successful! You can now login.',
      user: {
        id: authData.user.id,
        email: authData.user.email
      }
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    console.error('❌ Registration error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.'
    });
  }
});

module.exports = router;
