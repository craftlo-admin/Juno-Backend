const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/AuthController');
const logger = require('../utils/logger');

/**
 * Multi-tenant Website Builder - Auth Routes
 * Following project architecture: Express.js MVC, comprehensive error handling, production-ready
 * Supports both standalone OTP sending and unified registration flows
 */

// Route registration with comprehensive error handling
try {
  logger.info('🚀 Loading auth routes...');

  // Input validation middleware wrapper
  const validateAndHandle = (validationRules, handler) => {
    return [
      ...validationRules,
      async (req, res, next) => {
        try {
          await handler(req, res, next);
        } catch (error) {
          logger.error('Route handler error:', { 
            route: req.route?.path, 
            method: req.method, 
            error: error.message 
          });
          
          if (!res.headersSent) {
            res.status(500).json({
              error: 'Internal Server Error',
              message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
            });
          }
        }
      }
    ];
  };

  // STANDALONE OTP SENDING (for email + type only)
  router.post('/send-otp', async (req, res) => {
    try {
      const { email, type } = req.body;
      
      logger.info('📧 Standalone OTP request', { email, type });

      // Validation
      if (!email || !type) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Email and type are required',
          requiredFields: ['email', 'type']
        });
      }

      if (!['registration', 'password_reset', 'email_verification'].includes(type)) {
        return res.status(400).json({
          error: 'Invalid OTP Type',
          message: 'Type must be one of: registration, password_reset, email_verification',
          providedType: type
        });
      }

      // Call the standalone OTP method from AuthController
      await AuthController.sendOTP(req, res);

    } catch (error) {
      logger.error('Send OTP error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to send OTP'
      });
    }
  });

  // UNIFIED REGISTRATION FLOW (for full user data + OTP)
  router.post('/register', 
    validateAndHandle(AuthController.validateRegister || [], AuthController.register)
  );

  // OTP VERIFICATION (handles all OTP types including registration)
  router.post('/verify-otp', 
    validateAndHandle(AuthController.validateVerifyOTP || [], AuthController.verifyOTP)
  );

  // LOGIN FLOW
  router.post('/login', 
    validateAndHandle(AuthController.validateLogin || [], AuthController.login)
  );

  // GET CURRENT USER
  router.get('/me', async (req, res) => {
    try {
      if (typeof AuthController.getCurrentUser === 'function') {
        await AuthController.getCurrentUser(req, res);
      } else {
        res.status(501).json({
          error: 'Not Implemented',
          message: 'User profile endpoint not yet implemented'
        });
      }
    } catch (error) {
      logger.error('Get current user error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get user information'
      });
    }
  });

  // LOGOUT
  router.post('/logout', (req, res) => {
    try {
      res.json({
        message: 'Logout successful',
        note: 'For JWT-based authentication, please remove the token from client storage'
      });
    } catch (error) {
      logger.error('Logout error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Logout failed'
      });
    }
  });

  // HEALTH CHECK
  router.get('/health', (req, res) => {
    try {
      const healthData = {
        status: 'healthy',
        service: 'auth',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        uptime: process.uptime(),
        features: {
          registration: 'active',
          login: 'active',
          otpVerification: 'active',
          standaloneOTP: 'active',
          passwordReset: 'planned',
          userProfiles: 'planned'
        }
      };

      res.json(healthData);
    } catch (error) {
      logger.error('Health check error:', error);
      res.status(500).json({
        status: 'unhealthy',
        error: error.message
      });
    }
  });

  // DEVELOPMENT ROUTES
  if (process.env.NODE_ENV === 'development') {
    router.get('/debug/routes', (req, res) => {
      const routes = [];
      
      router.stack.forEach(layer => {
        if (layer.route) {
          const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
          routes.push(`${methods} /api/auth${layer.route.path}`);
        }
      });

      res.json({
        message: 'Auth routes debug information',
        routes,
        totalRoutes: routes.length,
        timestamp: new Date().toISOString()
      });
    });

    router.get('/debug/email', async (req, res) => {
      try {
        const { testEmailConfig } = require('../services/emailService');
        const emailStatus = await testEmailConfig();
        
        res.json({
          message: 'Email service debug information',
          emailService: emailStatus,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          error: 'Email debug failed',
          message: error.message
        });
      }
    });
  }

  logger.info('✅ Auth routes loaded successfully', {
    routeCount: router.stack.length,
    environment: process.env.NODE_ENV
  });

} catch (error) {
  logger.error('❌ Failed to load auth routes:', error);
  
  router.use('*', (req, res) => {
    res.status(503).json({
      error: 'Authentication Service Unavailable',
      message: 'Auth routes failed to load. Please check server configuration.',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Service temporarily unavailable',
      timestamp: new Date().toISOString()
    });
  });
}

// Global error handler for this router
router.use((error, req, res, next) => {
  logger.error('Auth router error:', {
    error: error.message,
    stack: error.stack,
    route: req.route?.path,
    method: req.method,
    body: req.body
  });

  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
