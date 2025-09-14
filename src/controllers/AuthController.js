const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const { sendOTPEmail } = require('../services/emailService');
const { createTenant } = require('../services/tenantService');

/**
 * Multi-tenant Website Builder - Auth Controller (Enhanced)
 * Following project architecture: Express.js MVC, comprehensive error handling, production-ready
 * Enhanced with robust database connection error handling
 */

// Import enhanced Prisma client with connection resilience
let prisma, executeWithRetry;
try {
  const dbModule = require('../lib/prisma');
  prisma = dbModule.prisma;
  executeWithRetry = dbModule.executeWithRetry;
  logger.info('✅ Enhanced Prisma client imported successfully in AuthController');
} catch (error) {
  logger.error('❌ Failed to import enhanced Prisma client in AuthController:', error);
}

// Import Redis client with memory fallback
let redisClient;
try {
  redisClient = require('../config/redis');
} catch (error) {
  logger.warn('Redis not available, using memory cache fallback.');
  const memoryCache = new Map();
  redisClient = {
    get: (key) => Promise.resolve(memoryCache.get(key) || null),
    set: (key, value, options) => {
      memoryCache.set(key, value);
      if (options?.EX) {
        setTimeout(() => memoryCache.delete(key), options.EX * 1000);
      }
      return Promise.resolve('OK');
    },
    del: (keys) => {
      const keysToDelete = Array.isArray(keys) ? keys : [keys];
      keysToDelete.forEach(key => memoryCache.delete(key));
      return Promise.resolve(keysToDelete.length);
    }
  };
}

class AuthController {
  // Validation middleware
  static validateRegister = [
    body('email').isEmail().withMessage('Please provide a valid email address.').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain an uppercase letter, a lowercase letter, a number, and a special character.'),
    body('firstName').trim().isLength({ min: 2 }).withMessage('First name must be at least 2 characters long.'),
    body('lastName').trim().isLength({ min: 2 }).withMessage('Last name must be at least 2 characters long.')
  ];

  static validateVerifyOTP = [
    body('email').isEmail().normalizeEmail(),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits.').isNumeric(),
    body('type').isIn(['registration', 'password_reset', 'email_verification'])
  ];

  /**
   * Enhanced database operation wrapper with connection error handling
   */
  static async executeDatabaseOperation(operation, operationName = 'Database operation') {
    try {
      if (!prisma) {
        throw new Error('Database client not available');
      }

      if (executeWithRetry) {
        return await executeWithRetry(operation);
      } else {
        return await operation();
      }
    } catch (error) {
      logger.error(`❌ ${operationName} failed:`, {
        error: error.message,
        code: error.code,
        meta: error.meta
      });

      // Handle specific database errors
      if (error.message.includes('connection was forcibly closed') ||
          error.message.includes('ConnectionReset') ||
          error.code === 'P1001' || error.code === 'P1017') {
        throw new Error('Database connection issue. Please try again in a moment.');
      } else if (error.code === 'P2002') {
        throw new Error('A record with this information already exists.');
      } else if (error.code === 'P2025') {
        throw new Error('Record not found.');
      }

      throw error;
    }
  }

  /**
   * STANDALONE OTP SENDING METHOD (Enhanced)
   * Sends OTP without requiring full registration data with connection resilience
   */
  static async sendOTP(req, res, next) {
    try {
      const { email, type } = req.body;
      
      logger.info('📧 Standalone OTP generation', { email, type });

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          error: 'Invalid Email',
          message: 'Please provide a valid email address'
        });
      }

      // Type-specific logic with enhanced database operations
      if (type === 'registration') {
        // Check if user already exists with retry logic
        const existingUser = await AuthController.executeDatabaseOperation(
          () => prisma.user.findUnique({ where: { email } }),
          'Check existing user for registration'
        );

        if (existingUser) {
          return res.status(409).json({
            error: 'User Already Exists',
            message: 'An account with this email address already exists',
            suggestion: 'Use login instead of registration'
          });
        }
      } else if (type === 'password_reset') {
        // For password reset, user must exist
        const existingUser = await AuthController.executeDatabaseOperation(
          () => prisma.user.findUnique({ where: { email } }),
          'Check existing user for password reset'
        );

        if (!existingUser) {
          return res.status(404).json({
            error: 'User Not Found',
            message: 'No account found with this email address'
          });
        }
      }

      // Generate OTP
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const otpKey = `otp:${type}:${email}`;
      
      // Store OTP in Redis/memory cache
      await redisClient.set(otpKey, otpCode, { EX: 600 }); // 10 minutes expiry

      // Send OTP email
      let emailResult = null;
      try {
        emailResult = await sendOTPEmail(email, otpCode, type);
        logger.info(`✅ Standalone OTP email sent`, { 
          email, 
          type,
          success: emailResult?.success, 
          isRealEmail: emailResult?.isRealEmail,
          mode: emailResult?.mode 
        });
      } catch (emailError) {
        logger.error('❌ Standalone OTP email failed:', emailError);
      }

      // Prepare response
      const responseData = {
        message: `OTP sent to ${email} for ${type}`,
        email,
        type,
        expiresIn: 600,
        nextStep: 'Use POST /api/auth/verify-otp to verify the OTP'
      };

      // In development, include OTP if email service is mocked
      if (process.env.NODE_ENV === 'development' && !emailResult?.isRealEmail) {
        responseData.otp = otpCode;
        responseData.note = 'OTP included for development (email service mocked)';
      }

      res.status(200).json(responseData);

    } catch (error) {
      logger.error('❌ Standalone OTP generation error:', error);
      
      if (error.message.includes('Database connection issue')) {
        return res.status(503).json({
          error: 'Service Temporarily Unavailable',
          message: 'Database connection issue. Please try again in a moment.',
          retryAfter: 30
        });
      }
      
      next(error);
    }
  }

  /**
   * UNIFIED REGISTRATION METHOD
   * Handles full registration with user data + OTP generation
   */
  static async register(req, res, next) {
    try {
      logger.info('🚀 Full registration initiated', { email: req.body.email });
      
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const { email, password, firstName, lastName } = req.body;

      // Database availability check
      if (!prisma || typeof prisma.user?.findUnique !== 'function') {
        return res.status(503).json({ error: 'Database unavailable' });
      }

      // Check existing user
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(409).json({ 
          error: 'User already exists', 
          message: 'An account with this email address already exists.' 
        });
      }

      // Hash password
      const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Store registration data temporarily
      const registrationData = { email, passwordHash, firstName, lastName, role: 'user' };
      const regKey = `registration:${email}`;
      await redisClient.set(regKey, JSON.stringify(registrationData), { EX: 900 });

      // Generate OTP
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const otpKey = `otp:registration:${email}`;
      await redisClient.set(otpKey, otpCode, { EX: 600 });

      logger.info('📧 Sending registration OTP', { email, otpCode: process.env.NODE_ENV === 'development' ? otpCode : '***' });

      // Send OTP email
      let emailResult = null;
      try {
        emailResult = await sendOTPEmail(email, otpCode, 'registration');
        logger.info(`✅ Registration OTP email sent`, { 
          email, 
          success: emailResult?.success, 
          isRealEmail: emailResult?.isRealEmail,
          mode: emailResult?.mode 
        });
      } catch (emailError) {
        logger.error('❌ Registration email send failed:', emailError);
      }

      // Response
      const responseData = {
        message: 'Registration initiated. Please check your email for the OTP.',
        email,
        step: 'otp_verification_required',
        expiresIn: 600,
        nextStep: 'Use POST /api/auth/verify-otp to complete registration'
      };

      // Development mode: include OTP if email service is mocked
      if (process.env.NODE_ENV === 'development' && !emailResult?.isRealEmail) {
        responseData.otp = otpCode;
        responseData.note = 'OTP included for development (email service mocked)';
      }

      res.status(202).json(responseData);

    } catch (error) {
      logger.error('❌ Registration error:', error);
      next(error);
    }
  }

  /**
   * UNIFIED OTP VERIFICATION METHOD
   * Handles all OTP verifications and completes registration
   */
  static async verifyOTP(req, res, next) {
    try {
      logger.info('🔍 OTP verification started', { email: req.body.email, type: req.body.type });
      
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const { email, otp, type } = req.body;

      // Verify OTP
      const otpKey = `otp:${type}:${email}`;
      const storedOTP = await redisClient.get(otpKey);

      if (!storedOTP) {
        return res.status(400).json({ 
          error: 'OTP expired', 
          message: 'OTP has expired. Please request a new one.' 
        });
      }

      if (storedOTP !== otp) {
        return res.status(400).json({ 
          error: 'Invalid OTP', 
          message: 'The OTP you entered is incorrect.' 
        });
      }

      logger.info('✅ OTP verified successfully', { email, type });

      // Delete OTP immediately after verification
      await redisClient.del(otpKey);

      // Handle registration completion
      if (type === 'registration') {
        return await AuthController.completeRegistration(req, res, next);
      }

      // For other OTP types
      res.status(200).json({
        message: 'OTP verified successfully',
        email,
        type,
        verified: true
      });

    } catch (error) {
      logger.error('❌ OTP verification error:', error);
      next(error);
    }
  }

  /**
   * COMPLETE REGISTRATION (Enhanced)
   * Called only after successful OTP verification with robust error handling
   */
  static async completeRegistration(req, res, next) {
    try {
      const { email } = req.body;
      
      logger.info('🏁 Completing registration', { email });

      // Get registration data
      const regKey = `registration:${email}`;
      const registrationDataStr = await redisClient.get(regKey);

      if (!registrationDataStr) {
        return res.status(400).json({ 
          error: 'Registration session expired', 
          message: 'Please start registration again.' 
        });
      }

      const registrationData = JSON.parse(registrationDataStr);

      // Create user and their personal tenant with enhanced error handling
      const result = await AuthController.executeDatabaseOperation(
        () => prisma.$transaction(async (tx) => {
          // Create user with available fields only
          const user = await tx.user.create({
            data: {
              email: registrationData.email,
              passwordHash: registrationData.passwordHash,
              firstName: registrationData.firstName,
              lastName: registrationData.lastName,
              role: registrationData.role || 'user',
              emailVerified: true,
              emailVerifiedAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date()
            }
          });

          logger.info('✅ User created successfully', { 
            userId: user.id, 
            email: user.email 
          });

          // Create tenant for the user
          const tenant = await createTenant(tx, user);

          logger.info('✅ Tenant created successfully', { 
            tenantId: tenant.id, 
            userId: user.id 
          });

          return { user, tenant };
        }),
        'Complete user registration transaction'
      );

      // Clean up temporary registration data from Redis
      await redisClient.del([`otp:registration:${email}`, regKey]);

      // Generate JWT with tenant information
      const jwtPayload = { 
        userId: result.user.id, 
        email: result.user.email, 
        tenantId: result.tenant.id,
        role: result.user.role
      };

      const token = jwt.sign(
        jwtPayload, 
        process.env.JWT_SECRET, 
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      // Set secure HTTP-only cookie for session management
      const isProd = process.env.NODE_ENV === 'production';
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'strict' : 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      logger.info('🎉 Registration completed successfully', { 
        userId: result.user.id, 
        tenantId: result.tenant.id,
        tenantIdentifier: result.tenant.tenantId 
      });

      res.status(201).json({
        message: 'Registration completed successfully',
        user: { 
          id: result.user.id, 
          email: result.user.email, 
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          role: result.user.role,
          emailVerified: result.user.emailVerified
        },
        tenant: { 
          id: result.tenant.id, 
          name: result.tenant.name,
          tenantId: result.tenant.tenantId,
          domain: result.tenant.domain,
          role: 'owner'
        },
        token,
        session: {
          expiresIn: process.env.JWT_EXPIRES_IN || '7d',
          tokenType: 'Bearer'
        }
      });

    } catch (error) {
      logger.error('❌ Registration completion error:', {
        error: error.message,
        stack: error.stack,
        email: req.body?.email
      });
      
      // Enhanced error handling for database issues
      if (error.message.includes('Database connection issue')) {
        return res.status(503).json({
          error: 'Service Temporarily Unavailable',
          message: 'Unable to complete registration due to database connectivity. Please try again.',
          retryAfter: 30
        });
      } else if (error.message.includes('already exists')) {
        return res.status(409).json({
          error: 'User Already Exists',
          message: 'An account with this email already exists'
        });
      }
      
      next(error);
    }
  }

  /**
   * LOGIN METHOD
   */
  static async login(req, res, next) {
    try {
      const { email, password } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { userId: user.id, email: user.email, tenantId: user.primaryTenantId }, 
        process.env.JWT_SECRET, 
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      res.json({
        message: 'Login successful',
        user: { id: user.id, email: user.email, firstName: user.firstName },
        token
      });

    } catch (error) {
      logger.error('Login error:', error);
      next(error);
    }
  }
}

module.exports = AuthController;
