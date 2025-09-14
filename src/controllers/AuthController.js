const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const { sendOTPEmail } = require('../services/emailService');
const { createTenant } = require('../services/tenantService');

/**
 * Multi-tenant Website Builder - Auth Controller (Enhanced with JWT Session Management)
 * Following project architecture: Express.js MVC, comprehensive error handling, production-ready
 * Enhanced with robust JWT token management for registration and login flows
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

  static validateLogin = [
    body('email').isEmail().withMessage('Please provide a valid email address.').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required.')
  ];

  static validateVerifyOTP = [
    body('email').isEmail().normalizeEmail(),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits.').isNumeric(),
    body('type').isIn(['registration', 'password_reset', 'email_verification'])
  ];

  /**
   * Enhanced JWT token management utilities
   */
  static generateJWT(payload, options = {}) {
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        throw new Error('JWT_SECRET is not configured');
      }

      const defaultOptions = {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
        issuer: process.env.JWT_ISSUER || 'website-builder',
        audience: process.env.JWT_AUDIENCE || 'website-builder-users'
      };

      const jwtOptions = { ...defaultOptions, ...options };
      
      // Add standard claims
      const enhancedPayload = {
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        jti: `${payload.userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` // Unique token ID
      };

      return jwt.sign(enhancedPayload, secret, jwtOptions);
    } catch (error) {
      logger.error('❌ JWT generation failed:', error);
      throw new Error('Token generation failed');
    }
  }

  static async saveJWTSession(userId, token, deviceInfo = {}) {
    try {
      const sessionData = {
        userId,
        token,
        deviceInfo: {
          userAgent: deviceInfo.userAgent || 'Unknown',
          ip: deviceInfo.ip || 'Unknown',
          platform: deviceInfo.platform || 'Unknown'
        },
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        isActive: true
      };

      // Save session in Redis with expiration matching JWT
      const sessionKey = `session:${userId}:${Date.now()}`;
      const expirationSeconds = 7 * 24 * 60 * 60; // 7 days in seconds
      
      await redisClient.set(sessionKey, JSON.stringify(sessionData), { EX: expirationSeconds });

      // Maintain user session list (for multi-device support)
      const userSessionsKey = `user_sessions:${userId}`;
      const existingSessions = await redisClient.get(userSessionsKey);
      const sessions = existingSessions ? JSON.parse(existingSessions) : [];
      
      sessions.push({
        sessionKey,
        deviceInfo: sessionData.deviceInfo,
        createdAt: sessionData.createdAt
      });

      // Keep only last 5 sessions per user
      if (sessions.length > 5) {
        const oldSession = sessions.shift();
        await redisClient.del(oldSession.sessionKey);
      }

      await redisClient.set(userSessionsKey, JSON.stringify(sessions), { EX: expirationSeconds });

      logger.info('✅ JWT session saved successfully', { 
        userId, 
        sessionKey,
        deviceInfo: sessionData.deviceInfo 
      });

      return sessionKey;
    } catch (error) {
      logger.error('❌ Failed to save JWT session:', error);
      throw new Error('Session management failed');
    }
  }

  static async validateAndRestoreJWT(token) {
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        throw new Error('JWT_SECRET is not configured');
      }

      // Verify and decode token
      const decoded = jwt.verify(token, secret);
      
      // Check if session exists in Redis
      const userSessionsKey = `user_sessions:${decoded.userId}`;
      const sessionsData = await redisClient.get(userSessionsKey);
      
      if (!sessionsData) {
        throw new Error('Session not found');
      }

      const sessions = JSON.parse(sessionsData);
      const activeSession = sessions.find(session => {
        // This is a simplified check - in production you'd want to match exact tokens
        return session.sessionKey.includes(decoded.userId);
      });

      if (!activeSession) {
        throw new Error('Session not active');
      }

      // Update last used timestamp
      const sessionData = await redisClient.get(activeSession.sessionKey);
      if (sessionData) {
        const session = JSON.parse(sessionData);
        session.lastUsed = new Date().toISOString();
        await redisClient.set(activeSession.sessionKey, JSON.stringify(session), { EX: 7 * 24 * 60 * 60 });
      }

      logger.info('✅ JWT session validated and restored', { 
        userId: decoded.userId,
        sessionKey: activeSession.sessionKey 
      });

      return decoded;
    } catch (error) {
      logger.error('❌ JWT validation/restoration failed:', error);
      throw new Error('Invalid or expired session');
    }
  }

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
   * COMPLETE REGISTRATION (Enhanced with JWT Session Management)
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
        role: result.user.role,
        type: 'registration'
      };

      const token = AuthController.generateJWT(jwtPayload);

      // Extract device information from request
      const deviceInfo = {
        userAgent: req.get('User-Agent') || 'Unknown',
        ip: req.ip || req.connection.remoteAddress || 'Unknown',
        platform: req.get('X-Platform') || 'web'
      };

      // Save JWT session
      const sessionKey = await AuthController.saveJWTSession(result.user.id, token, deviceInfo);

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
        tenantIdentifier: result.tenant.tenantId,
        sessionKey
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
          sessionKey,
          expiresIn: process.env.JWT_EXPIRES_IN || '7d',
          tokenType: 'Bearer',
          deviceInfo: {
            platform: deviceInfo.platform,
            registeredAt: new Date().toISOString()
          }
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
   * ENHANCED LOGIN METHOD with JWT Session Restoration (FIXED)
   */
  static async login(req, res, next) {
    try {
      logger.info('🔐 Login attempt', { email: req.body.email });

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const { email, password } = req.body;

      // Find user with enhanced error handling - FIXED QUERY
      const user = await AuthController.executeDatabaseOperation(
        () => prisma.user.findUnique({ 
          where: { email },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            passwordHash: true,
            emailVerified: true,
            emailVerifiedAt: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true
          }
        }),
        'User lookup for login'
      );

      if (!user) {
        logger.warn('❌ Login failed - user not found', { email });
        return res.status(401).json({ 
          error: 'Invalid credentials',
          message: 'Email or password is incorrect'
        });
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
      if (!isPasswordValid) {
        logger.warn('❌ Login failed - invalid password', { email, userId: user.id });
        return res.status(401).json({ 
          error: 'Invalid credentials',
          message: 'Email or password is incorrect'
        });
      }

      // Check if user is active/verified
      if (!user.emailVerified) {
        return res.status(403).json({
          error: 'Account Not Verified',
          message: 'Please verify your email address before logging in',
          requiresVerification: true
        });
      }

      // Get user's primary tenant in a separate query - FIXED APPROACH
      const primaryTenant = await AuthController.executeDatabaseOperation(
        () => prisma.tenant.findFirst({
          where: { 
            ownerId: user.id,
            status: 'active'
          },
          select: {
            id: true,
            name: true,
            tenantId: true,
            domain: true,
            status: true
          }
        }),
        'Get user primary tenant for login'
      );

      // Generate JWT with comprehensive payload
      const jwtPayload = { 
        userId: user.id, 
        email: user.email, 
        tenantId: primaryTenant?.id || null,
        role: user.role,
        type: 'login',
        permissions: [] // Add user permissions here if applicable
      };

      const token = AuthController.generateJWT(jwtPayload);

      // Extract device information from request
      const deviceInfo = {
        userAgent: req.get('User-Agent') || 'Unknown',
        ip: req.ip || req.connection.remoteAddress || 'Unknown',
        platform: req.get('X-Platform') || 'web'
      };

      // Save JWT session
      const sessionKey = await AuthController.saveJWTSession(user.id, token, deviceInfo);

      // Update last login timestamp
      await AuthController.executeDatabaseOperation(
        () => prisma.user.update({
          where: { id: user.id },
          data: { 
            lastLoginAt: new Date(),
            updatedAt: new Date()
          }
        }),
        'Update last login timestamp'
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

      logger.info('✅ Login successful', { 
        userId: user.id, 
        email: user.email,
        tenantId: primaryTenant?.id,
        sessionKey
      });

      // Prepare response without sensitive data
      const userResponse = {
        id: user.id, 
        email: user.email, 
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        emailVerified: user.emailVerified,
        lastLoginAt: new Date().toISOString()
      };

      const tenantResponse = primaryTenant ? {
        id: primaryTenant.id,
        name: primaryTenant.name,
        tenantId: primaryTenant.tenantId,
        domain: primaryTenant.domain,
        role: 'owner'
      } : null;

      res.status(200).json({
        message: 'Login successful',
        user: userResponse,
        tenant: tenantResponse,
        token,
        session: {
          sessionKey,
          expiresIn: process.env.JWT_EXPIRES_IN || '7d',
          tokenType: 'Bearer',
          deviceInfo: {
            platform: deviceInfo.platform,
            loginAt: new Date().toISOString()
          }
        }
      });

    } catch (error) {
      logger.error('❌ Login error:', {
        error: error.message,
        stack: error.stack,
        email: req.body?.email
      });

      if (error.message.includes('Database connection issue')) {
        return res.status(503).json({
          error: 'Service Temporarily Unavailable',
          message: 'Unable to process login due to database connectivity. Please try again.',
          retryAfter: 30
        });
      }

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
   * LOGOUT METHOD - Invalidates JWT session
   */
  static async logout(req, res, next) {
    try {
      const token = req.cookies.auth_token || req.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return res.status(400).json({
          error: 'No active session',
          message: 'No authentication token found'
        });
      }

      // Decode token to get user ID
      const decoded = await AuthController.validateAndRestoreJWT(token);
      
      // Invalidate session in Redis
      const userSessionsKey = `user_sessions:${decoded.userId}`;
      const sessionsData = await redisClient.get(userSessionsKey);
      
      if (sessionsData) {
        const sessions = JSON.parse(sessionsData);
        // Remove the current session and invalidate associated session keys
        for (const session of sessions) {
          await redisClient.del(session.sessionKey);
        }
        await redisClient.del(userSessionsKey);
      }

      // Clear cookie
      res.clearCookie('auth_token');

      logger.info('✅ Logout successful', { userId: decoded.userId });

      res.status(200).json({
        message: 'Logout successful',
        loggedOut: true
      });

    } catch (error) {
      logger.error('❌ Logout error:', error);
      // Clear cookie anyway
      res.clearCookie('auth_token');
      
      res.status(200).json({
        message: 'Logout completed',
        note: 'Session may have already been invalid'
      });
    }
  }

  /**
   * GET CURRENT USER - Validates and restores JWT session
   */
  static async getCurrentUser(req, res, next) {
    try {
      const token = req.cookies.auth_token || req.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication token required'
        });
      }

      // Validate and restore JWT
      const decoded = await AuthController.validateAndRestoreJWT(token);
      
      // Get current user data
      const user = await AuthController.executeDatabaseOperation(
        () => prisma.user.findUnique({
          where: { id: decoded.userId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            emailVerified: true,
            lastLoginAt: true,
            createdAt: true
          }
        }),
        'Get current user data'
      );

      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'User account no longer exists'
        });
      }

      // Get user's tenant information
      const tenant = decoded.tenantId ? await AuthController.executeDatabaseOperation(
        () => prisma.tenant.findUnique({
          where: { id: decoded.tenantId },
          select: {
            id: true,
            name: true,
            tenantId: true,
            domain: true,
            status: true
          }
        }),
        'Get user tenant data'
      ) : null;

      res.status(200).json({
        user,
        tenant,
        session: {
          tokenType: 'Bearer',
          expiresIn: process.env.JWT_EXPIRES_IN || '7d',
          isValid: true
        }
      });

    } catch (error) {
      logger.error('❌ Get current user error:', error);
      
      if (error.message.includes('Invalid or expired session')) {
        return res.status(401).json({
          error: 'Session Expired',
          message: 'Please log in again',
          requiresReauth: true
        });
      }

      next(error);
    }
  }
}

module.exports = AuthController;
