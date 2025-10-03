const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client for token verification
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in auth middleware!');
  console.error('Please set these environment variables for authentication to work.');
  throw new Error('Missing Supabase configuration for authentication');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }

  try {
    // Verify Supabase token
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    // Get user from our database
    const { data: dbUser, error: dbError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (dbError || !dbUser) {
      // If user doesn't exist in our database, create a basic record
      const { error: insertError } = await supabase
        .from('users')
        .insert({
          id: user.id,
          phone: user.email, // Using email as phone
          role: 'vendor',
          is_verified: true
        });

      if (insertError) {
        console.error('Error creating user record:', insertError);
      }

      // Set user data for request
      req.user = {
        id: user.id,
        email: user.email,
        role: 'vendor',
        is_verified: true
      };
    } else {
      req.user = dbUser;
    }

    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userRoles = Array.isArray(roles) ? roles : [roles];
    if (!userRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  requireRole
};
