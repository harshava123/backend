const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const http = require('http');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet());
// CORS configuration for both local development and production deployment
const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || [
  'http://localhost:3000', 
  'http://localhost:3001', 
  'http://localhost:3002',
  'http://localhost:5000'
];

// Add production domains dynamically
if (process.env.NODE_ENV === 'production') {
  allowedOrigins.push(
    'https://vendor-admin-bazaar.vercel.app',
    'https://bazar-story.vercel.app'
  );
}

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Always allow localhost in development
    if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // For Vercel preview deployments, allow any *.vercel.app domain
    if (process.env.NODE_ENV === 'production' && origin.includes('.vercel.app')) {
      return callback(null, true);
    }
    
    // For production, be more restrictive
    if (process.env.NODE_ENV === 'production') {
      console.log(`CORS blocked origin: ${origin}`);
      return callback(new Error('Not allowed by CORS'));
    }
    
    // In development, allow most origins for easier testing
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Logging
app.use(morgan('combined'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use('/uploads', express.static('uploads'));

// Import routes
const authRoutes = require('./routes/auth');
const registerRoutes = require('./routes/register');
const productRoutes = require('./routes/products');
const categoryRoutes = require('./routes/categories');
const orderRoutes = require('./routes/orders');
const cartRoutes = require('./routes/cart');
const uploadRoutes = require('./routes/upload');
const webrtcLivestreamRoutes = require('./routes/webrtc-livestream');
const adminRoutes = require('./routes/admin');
const adminCategoryRoutes = require('./routes/admin-categories');
const { testConnection } = require('./config/database');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/register', registerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/livestreams', webrtcLivestreamRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/categories', adminCategoryRoutes);

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Vendor Admin Backend is running',
    timestamp: new Date().toISOString()
  });
});

// Test database connection on startup
testConnection();

// Initialize WebRTC streaming service
const webrtcStreamingService = require('./services/webrtc-streaming');
webrtcStreamingService.initialize(server);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🎥 WebRTC streaming service ready`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
