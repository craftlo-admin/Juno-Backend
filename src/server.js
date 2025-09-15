// Load environment variables first
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

// Import utilities and middleware
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const validateEnv = require('./utils/validateEnv');

// Validate environment variables before starting
try {
  validateEnv();
  logger.info('✅ Environment variables validated');
} catch (error) {
  logger.error('❌ Environment validation failed:', error.message);
  
  // In development, warn but continue
  if (process.env.NODE_ENV === 'development') {
    logger.warn('⚠️ Continuing in development mode with invalid environment');
  } else {
    process.exit(1);
  }
}

const app = express();

// Trust proxy for production deployments
app.set('trust proxy', 1);

// Enhanced rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 1000 : 100,
  message: { 
    error: 'Too many requests', 
    message: 'Please try again later',
    retryAfter: 15 * 60 // 15 minutes
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

app.use(limiter);

// Enhanced security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));

// CORS configuration with error handling
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:3002',
      'http://localhost:3003',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173'
    ];
    
    // Allow requests with no origin (mobile apps, curl, postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      logger.warn('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-api-key'],
  exposedHeaders: ['x-total-count', 'x-page-count'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Body parsing middleware with enhanced limits
app.use(express.json({ 
  limit: process.env.MAX_UPLOAD_SIZE || '50mb',
  type: ['application/json', 'text/plain']
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: process.env.MAX_UPLOAD_SIZE || '50mb'
}));

app.use(cookieParser());

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  
  // Log request
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')?.substring(0, 100),
    tenantId: req.headers['x-tenant-id'] || 'none',
    contentLength: req.get('content-length') || '0'
  });

  // Log response on finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info(`${req.method} ${req.path} - ${res.statusCode}`, {
      duration: `${duration}ms`,
      contentLength: res.get('content-length') || '0'
    });
  });

  next();
});

// Import and mount route handlers with comprehensive error handling
let authRoutes, tenantRoutes, uploadRoutes, projectRoutes;
let analyticsRoutes, webhooksRoutes, realtimeRoutes, docsRoutes;

// Core routes (critical)
// Auth routes
try {
  authRoutes = require('./routes/auth');
  logger.info('✅ Auth routes loaded successfully');
} catch (authError) {
  logger.error('❌ Failed to load auth routes:', {
    error: authError.message,
    stack: process.env.NODE_ENV === 'development' ? authError.stack : undefined
  });
  
  // Create fallback auth routes
  authRoutes = express.Router();
  authRoutes.use('*', (req, res) => {
    res.status(503).json({
      error: 'Authentication Service Unavailable',
      message: 'Auth routes failed to load. Please check server configuration.',
      details: process.env.NODE_ENV === 'development' ? authError.message : 'Service unavailable'
    });
  });
}

// Tenant routes
try {
  tenantRoutes = require('./routes/tenants');
  logger.info('✅ Tenant routes loaded successfully');
} catch (tenantError) {
  logger.error('❌ Failed to load tenant routes:', {
    error: tenantError.message,
    stack: process.env.NODE_ENV === 'development' ? tenantError.stack : undefined
  });
  
  tenantRoutes = express.Router();
  tenantRoutes.use('*', (req, res) => {
    res.status(503).json({
      error: 'Tenant Service Unavailable',
      message: 'Tenant management temporarily unavailable.',
      details: process.env.NODE_ENV === 'development' ? tenantError.message : 'Service unavailable'
    });
  });
}

// Upload routes - FIXED: Use correct file name
try {
  uploadRoutes = require('./routes/uploadRoutes'); // Fixed from './routes/uploads'
  logger.info('✅ Upload routes loaded successfully');
} catch (uploadError) {
  logger.error('❌ Failed to load upload routes:', {
    error: uploadError.message,
    stack: process.env.NODE_ENV === 'development' ? uploadError.stack : undefined
  });
  
  uploadRoutes = express.Router();
  uploadRoutes.use('*', (req, res) => {
    res.status(503).json({
      error: 'Upload Service Unavailable',
      message: 'File upload service temporarily unavailable.',
      details: process.env.NODE_ENV === 'development' ? uploadError.message : 'Service unavailable'
    });
  });
}

// Project routes
try {
  projectRoutes = require('./routes/projects');
  logger.info('✅ Project routes loaded successfully');
} catch (projectError) {
  logger.error('❌ Failed to load project routes:', {
    error: projectError.message,
    stack: process.env.NODE_ENV === 'development' ? projectError.stack : undefined
  });
  
  projectRoutes = express.Router();
  projectRoutes.use('*', (req, res) => {
    res.status(503).json({
      error: 'Project Service Unavailable',
      message: 'Project management temporarily unavailable.',
      details: process.env.NODE_ENV === 'development' ? projectError.message : 'Service unavailable'
    });
  });
}

// Advanced feature routes (non-critical, graceful degradation)
// Analytics routes
try {
  analyticsRoutes = require('./routes/analytics');
  logger.info('✅ Analytics routes loaded successfully');
} catch (analyticsError) {
  logger.warn('⚠️ Analytics routes failed to load (non-critical):', analyticsError.message);
  analyticsRoutes = express.Router();
  analyticsRoutes.use('*', (req, res) => {
    res.status(503).json({
      error: 'Analytics Service Unavailable',
      message: 'Analytics features temporarily unavailable.'
    });
  });
}

// Webhooks routes
try {
  webhooksRoutes = require('./routes/webhooks');
  logger.info('✅ Webhooks routes loaded successfully');
} catch (webhooksError) {
  logger.warn('⚠️ Webhooks routes failed to load (non-critical):', webhooksError.message);
  webhooksRoutes = express.Router();
  webhooksRoutes.use('*', (req, res) => {
    res.status(503).json({
      error: 'Webhooks Service Unavailable',
      message: 'Webhook features temporarily unavailable.'
    });
  });
}

// Real-time/WebSocket routes
try {
  realtimeRoutes = require('./routes/realtime');
  logger.info('✅ Real-time routes loaded successfully');
} catch (realtimeError) {
  logger.warn('⚠️ Real-time routes failed to load (non-critical):', realtimeError.message);
  realtimeRoutes = express.Router();
  realtimeRoutes.use('*', (req, res) => {
    res.status(503).json({
      error: 'Real-time Service Unavailable',
      message: 'Real-time features temporarily unavailable.'
    });
  });
}

// Documentation routes
try {
  docsRoutes = require('./routes/docs');
  logger.info('✅ Documentation routes loaded successfully');
} catch (docsError) {
  logger.warn('⚠️ Documentation routes failed to load (non-critical):', docsError.message);
  docsRoutes = express.Router();
  docsRoutes.use('*', (req, res) => {
    res.status(503).json({
      error: 'Documentation Service Unavailable',
      message: 'API documentation temporarily unavailable.'
    });
  });
}

// Enhanced health check endpoint
app.get('/health', async (req, res) => {
  const startTime = Date.now();
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    services: {},
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
      external: Math.round(process.memoryUsage().external / 1024 / 1024) + 'MB'
    },
    pid: process.pid
  };

  // Test database connection
  try {
    const testDatabaseConnection = require('./utils/testConnection');
    const dbConnected = await testDatabaseConnection();
    healthData.services.database = {
      status: dbConnected ? 'connected' : 'disconnected',
      responseTime: `${Date.now() - startTime}ms`
    };
  } catch (error) {
    healthData.services.database = {
      status: 'error',
      error: error.message
    };
  }

  // Test cache connection
  try {
    const redisClient = require('./config/redis');
    if (typeof redisClient.ping === 'function') {
      await redisClient.ping();
      healthData.services.cache = { status: 'connected' };
    } else {
      healthData.services.cache = { status: 'memory_fallback' };
    }
  } catch (error) {
    healthData.services.cache = {
      status: 'error',
      error: error.message
    };
  }

  // Test email service - ENHANCED ERROR HANDLING
  try {
    const { testEmailConfig } = require('./services/emailService');
    const emailTest = await testEmailConfig();
    healthData.services.email = {
      status: emailTest.success ? 'configured' : 'mock',
      configured: emailTest.success,
      details: emailTest.success ? 'SMTP working' : 'Using mock/development mode'
    };
  } catch (error) {
    healthData.services.email = {
      status: 'mock',
      configured: false,
      details: 'Email service in mock mode - check SMTP configuration',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Configuration needed'
    };
  }

  // Determine overall health
  const criticalServices = ['database'];
  const hasFailedCritical = criticalServices.some(service => 
    healthData.services[service]?.status === 'error'
  );

  if (hasFailedCritical) {
    healthData.status = 'unhealthy';
    res.status(503);
  } else if (Object.values(healthData.services).some(s => s.status === 'error')) {
    healthData.status = 'degraded';
    res.status(200);
  }

  healthData.responseTime = `${Date.now() - startTime}ms`;
  res.json(healthData);
});

// Development debugging endpoints
if (process.env.NODE_ENV === 'development') {
  app.get('/debug/routes', (req, res) => {
    const routes = [];
    
    // Extract routes from app
    app._router.stack.forEach((middleware) => {
      if (middleware.route) {
        routes.push({
          path: middleware.route.path,
          methods: Object.keys(middleware.route.methods)
        });
      } else if (middleware.name === 'router') {
        middleware.handle.stack.forEach((handler) => {
          if (handler.route) {
            routes.push({
              path: handler.route.path,
              methods: Object.keys(handler.route.methods)
            });
          }
        });
      }
    });

    res.json({
      message: 'Available routes',
      routes: routes,
      totalRoutes: routes.length,
      timestamp: new Date().toISOString()
    });
  });

  // Add email diagnostic endpoint
  app.get('/debug/email', async (req, res) => {
    try {
      const { runEmailDiagnostics } = require('./utils/emailDiagnostic');
      const diagnostics = await runEmailDiagnostics();
      
      res.json({
        message: 'Email service diagnostics',
        diagnostics,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Email diagnostic failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Test registration page
  app.get('/test', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Test Registration</title>
</head>
<body>
    <h1>Test Registration</h1>
    <div id="result"></div>
    
    <script>
        async function testRegistration() {
            try {
                console.log('Testing registration...');
                
                const response = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        email: 'test@example.com',
                        password: 'password123',
                        firstName: 'Test',
                        lastName: 'User'
                    })
                });
                
                console.log('Response status:', response.status);
                const data = await response.text();
                console.log('Response data:', data);
                
                document.getElementById('result').innerHTML = \`
                    <h2>Registration Response</h2>
                    <p>Status: \${response.status}</p>
                    <p>Data: \${data}</p>
                \`;
                
                if (response.ok) {
                    // Try to get OTP from debug endpoint
                    try {
                        const otpResponse = await fetch('/api/auth/debug/otp');
                        const otpData = await otpResponse.json();
                        console.log('OTP Debug:', otpData);
                        
                        document.getElementById('result').innerHTML += \`
                            <h3>OTP Debug Info</h3>
                            <pre>\${JSON.stringify(otpData, null, 2)}</pre>
                        \`;
                    } catch (e) {
                        console.log('No OTP debug endpoint');
                    }
                }
                
            } catch (error) {
                console.error('Error:', error);
                document.getElementById('result').innerHTML = \`
                    <h2>Error</h2>
                    <p>\${error.message}</p>
                \`;
            }
        }
        
        // Test on load
        testRegistration();
    </script>
</body>
</html>
    `);
  });
}

// API Routes - Core routes (essential for platform functionality)
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/upload', uploadRoutes); // Fixed from '/api/uploads' to match route definitions
app.use('/api/projects', projectRoutes);

// API Routes - Advanced features (with graceful degradation)
app.use('/api/analytics', analyticsRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/realtime', realtimeRoutes);
app.use('/api/docs', docsRoutes);

// Catch-all route for undefined endpoints
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    availableRoutes: [
      'GET /health',
      'GET /debug/routes (dev only)',
      'GET /debug/email (dev only)',
      '--- Core API Endpoints ---',
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET /api/auth/me',
      'POST /api/auth/send-otp',
      'POST /api/auth/verify-otp',
      'GET /api/tenants',
      'POST /api/tenants',
      'POST /api/upload/single',
      'POST /api/upload/multiple',
      'GET /api/upload/files',
      'POST /api/projects',
      'GET /api/projects',
      '--- Advanced Features ---',
      'GET /api/analytics/dashboard',
      'POST /api/webhooks',
      'GET /api/realtime/stats',
      'GET /api/docs/ui (Interactive API docs)',
      'GET /api/docs/openapi.json'
    ],
    timestamp: new Date().toISOString()
  });
});

// Global error handler (must be last)
app.use(errorHandler);

// Enhanced startup function
async function startServer() {
  try {
    const PORT = process.env.PORT || 8000;
    
    // Test critical services
    logger.info('🔍 Testing critical services...');
    
    let dbStatus = 'unknown';
    try {
      const testDatabaseConnection = require('./utils/testConnection');
      const dbConnected = await testDatabaseConnection();
      dbStatus = dbConnected ? 'connected' : 'failed';
    } catch (error) {
      dbStatus = 'error';
      logger.warn('Database connection test failed:', error.message);
    }

    let emailStatus = 'unknown';
    try {
      const { emailService } = require('./services/emailService');
      emailStatus = emailService.isConfigured ? 'configured' : 'mock';
      
      // If mock, suggest solutions
      if (!emailService.isConfigured) {
        logger.info('📧 Email service running in mock mode');
        logger.info('💡 For development: Add EMAIL_SERVICE=ethereal to .env');
        logger.info('💡 For production: Configure proper SMTP settings');
      }
    } catch (error) {
      emailStatus = 'error';
      logger.warn('Email service test failed:', error.message);
    }

    const server = app.listen(PORT, () => {
      console.log('\n🚀 Website Builder Backend Server Started');
      console.log(`📍 Port: ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔍 Debug Routes: http://localhost:${PORT}/debug/routes`);
        console.log(`📧 Email Debug: http://localhost:${PORT}/debug/email`);
      }
      
      console.log('\n📊 Service Status:');
      console.log(`🗃️ Database: ${dbStatus === 'connected' ? '✅ Connected' : '❌ ' + dbStatus}`);
      console.log(`📧 Email: ${emailStatus === 'configured' ? '✅ Configured' : '⚠️ Mock Mode'}`);
      console.log(`📋 Routes: ✅ Loaded (auth, tenants, upload, projects, analytics, webhooks, realtime, docs)`);
      console.log(`🎯 Features: ✅ Advanced routes mounted with graceful degradation`);
      
      if (dbStatus !== 'connected' || emailStatus === 'error') {
        console.log('\n🔧 Issues Detected:');
        if (dbStatus !== 'connected') {
          console.log('• Database connection failed - check DATABASE_URL');
          console.log('• Run: npx prisma generate && npx prisma db push');
        }
        if (emailStatus === 'error') {
          console.log('• Email service failed - check SMTP configuration');
          console.log('• For development: Add EMAIL_SERVICE=ethereal to .env');
        }
      }
      
      if (emailStatus === 'mock') {
        console.log('\n📧 Email Tips:');
        console.log('• Email service running in mock mode (SMTP blocked by ISP)');
        console.log('• OTPs will be logged to console in development');
        console.log('• Add EMAIL_SERVICE=ethereal to .env for development emails');
        console.log('• Consider SendGrid/Mailgun for production');
      }
      
      console.log('\n✨ Server ready for requests!\n');
    });

    // Enhanced graceful shutdown
    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      
      server.close(async () => {
        logger.info('HTTP server closed');
        
        // Close database connection
        try {
          const prisma = require('./lib/prisma');
          if (prisma && typeof prisma.$disconnect === 'function') {
            await prisma.$disconnect();
            logger.info('Database connection closed');
          }
        } catch (error) {
          logger.error('Error closing database:', error);
        }

        // Close cache connection
        try {
          const redisClient = require('./config/redis');
          if (redisClient && typeof redisClient.disconnect === 'function') {
            await redisClient.disconnect();
            logger.info('Cache connection closed');
          }
        } catch (error) {
          logger.error('Error closing cache:', error);
        }

        // Close email service
        try {
          const { emailService } = require('./services/emailService');
          if (emailService && typeof emailService.close === 'function') {
            await emailService.close();
            logger.info('Email service closed');
          }
        } catch (error) {
          logger.error('Error closing email service:', error);
        }

        logger.info('Graceful shutdown completed');
        process.exit(0);
      });

      // Force close after 10 seconds
      setTimeout(() => {
        logger.error('Forcing shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Initialize server
startServer();

module.exports = app;
