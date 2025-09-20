const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const { generateToken } = require('../utils/jwt');
const { generateOTP } = require('../utils/otp');
const { sendOTPEmail } = require('../services/emailService');

/**
 * Multi-tenant Website Builder - Auth Controller (Clean Refactored)
 * Following project architecture: Express.js MVC, clean separation of concerns
 * Uses utility modules for JWT and OTP generation
 */

// Import enhanced Prisma client
let prisma, executeWithRetry;
try {
  const dbModule = require('../lib/prisma');
  prisma = dbModule.prisma;
  executeWithRetry = dbModule.executeWithRetry;
  logger.info('✅ Enhanced Prisma client imported successfully in AuthController');
} catch (error) {
  logger.error('❌ Failed to import enhanced Prisma client in AuthController:', error);
}

// Simple in-memory OTP storage with attempt tracking (use Redis in production)
const otpStore = new Map();
const otpAttempts = new Map(); // Track failed attempts per email

// Rate limiting for OTP attempts
const MAX_OTP_ATTEMPTS = 5;
const OTP_LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

// Rate limiting for login attempts
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_TIME = 30 * 60 * 1000; // 30 minutes

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
   * Register new user
   */
  static async register(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { email, password, firstName, lastName } = req.body;

      // Check if user exists
      const existingUser = await executeWithRetry(
        () => prisma.user.findUnique({ where: { email } }),
        3
      );

      if (existingUser) {
        return res.status(409).json({
          error: 'User already exists with this email address'
        });
      }

      // Generate OTP and store registration data
      const otp = generateOTP();
      const hashedPassword = await bcrypt.hash(password, 12);
      
      const registrationData = {
        email,
        passwordHash: hashedPassword,
        firstName,
        lastName,
        otp,
        timestamp: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
      };

      // Store in memory (use Redis in production)
      otpStore.set(`registration:${email}`, registrationData);
      
      // Schedule cleanup
      setTimeout(() => otpStore.delete(`registration:${email}`), 10 * 60 * 1000);

      // Send OTP email
      await sendOTPEmail(email, otp, 'registration');
      
      logger.info('🚀 Registration initiated', { email });

      res.status(202).json({
        success: true,
        message: 'Registration OTP sent to your email. Please verify to complete registration.',
        data: { email, otpSent: true }
      });
    } catch (error) {
      logger.error('❌ Registration failed:', error);
      next(error);
    }
  }

  /**
   * Verify OTP and complete registration
   */
  static async verifyOTP(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { email, otp, type } = req.body;

      // Check for rate limiting
      const attemptKey = `${type}:${email}`;
      const attempts = otpAttempts.get(attemptKey) || { count: 0, lastAttempt: 0 };
      
      if (attempts.count >= MAX_OTP_ATTEMPTS && 
          Date.now() - attempts.lastAttempt < OTP_LOCKOUT_TIME) {
        return res.status(429).json({
          error: 'Too many failed attempts',
          message: 'Please wait 15 minutes before trying again'
        });
      }

      if (type === 'registration') {
        const registrationData = otpStore.get(`registration:${email}`);
        
        // Secure logging - don't log OTP values
        logger.info('🔍 Verifying OTP', { 
          email, 
          type, 
          hasRegistrationData: !!registrationData,
          isExpired: registrationData ? Date.now() > registrationData.expiresAt : null,
          attemptCount: attempts.count
        });
        
        // Standardized error response to prevent timing attacks
        const invalidResponse = {
          error: 'Invalid or expired OTP',
          message: 'Please check your OTP or request a new one'
        };
        
        if (!registrationData || registrationData.otp !== otp || 
            Date.now() > registrationData.expiresAt) {
          
          // Track failed attempt
          attempts.count++;
          attempts.lastAttempt = Date.now();
          otpAttempts.set(attemptKey, attempts);
          
          return res.status(400).json(invalidResponse);
        }

        // Success - reset attempts and clean up
        otpAttempts.delete(attemptKey);
        otpStore.delete(`registration:${email}`);

        // Create user in transaction
        const result = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: registrationData.email,
              passwordHash: registrationData.passwordHash,
              firstName: registrationData.firstName,
              lastName: registrationData.lastName,
              emailVerified: true,
              emailVerifiedAt: new Date()
            }
          });

          logger.info('🔍 User created in transaction', { 
            user: user,
            hasId: !!user?.id,
            hasEmail: !!user?.email,
            userKeys: Object.keys(user || {}),
            userId: user?.id,
            userEmail: user?.email
          });

          // Ensure user has required fields
          if (!user || !user.id || !user.email) {
            throw new Error(`User creation failed: missing required fields. User: ${JSON.stringify(user)}`);
          }

          return { user };
        });

        // Clean up OTP store
        otpStore.delete(`registration:${email}`);

        // Generate JWT token (without tenantId - user can create tenants later)
        const token = generateToken({
          userId: result.user.id,
          email: result.user.email
        });

        logger.info('✅ Registration completed', { 
          userId: result.user.id
        });

        res.status(201).json({
          success: true,
          message: 'Registration completed successfully. You can now create tenants to deploy your websites.',
          data: {
            user: {
              id: result.user.id,
              email: result.user.email,
              firstName: result.user.firstName,
              lastName: result.user.lastName
            },
            token
          }
        });
      } else {
        res.status(400).json({
          error: 'Invalid OTP type'
        });
      }
    } catch (error) {
      logger.error('❌ OTP verification failed:', error);
      next(error);
    }
  }

  /**
   * User login
   */
  static async login(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { email, password } = req.body;
      
      // Check login rate limiting
      const loginAttemptData = loginAttempts.get(email) || { count: 0, lastAttempt: 0 };
      
      if (loginAttemptData.count >= MAX_LOGIN_ATTEMPTS && 
          Date.now() - loginAttemptData.lastAttempt < LOGIN_LOCKOUT_TIME) {
        return res.status(429).json({
          error: 'Account temporarily locked',
          message: 'Too many failed login attempts. Please try again in 30 minutes.'
        });
      }
      
      logger.info('🔐 Login attempt', { email, attemptCount: loginAttemptData.count });

      // Find user
      const user = await executeWithRetry(
        () => prisma.user.findUnique({ 
          where: { email },
          include: {
            tenants: {
              select: {
                id: true,
                tenantId: true,
                name: true,
                domain: true,
                status: true
              }
            }
          }
        }),
        3
      );

      if (!user || !await bcrypt.compare(password, user.passwordHash)) {
        // Track failed login attempt
        loginAttemptData.count++;
        loginAttemptData.lastAttempt = Date.now();
        loginAttempts.set(email, loginAttemptData);
        
        return res.status(401).json({
          error: 'Invalid credentials',
          message: 'Email or password is incorrect'
        });
      }

      // Success - reset login attempts
      loginAttempts.delete(email);

      // Update last login
      await executeWithRetry(
        () => prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() }
        }),
        3
      );

      // Generate JWT token (without specific tenantId - user can select tenant)
      const token = generateToken({
        userId: user.id,
        email: user.email
      });

      logger.info('✅ Login successful', { userId: user.id });

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            emailVerified: user.emailVerified
          },
          tenants: user.tenants,
          token
        }
      });
    } catch (error) {
      logger.error('❌ Login failed:', error);
      next(error);
    }
  }

  /**
   * Send OTP for various purposes
   */
  static async sendOTP(req, res, next) {
    try {
      const { email, type = 'registration' } = req.body;

      if (!email || !email.includes('@')) {
        return res.status(400).json({
          error: 'Valid email address is required'
        });
      }

      // For registration type, check if registration data already exists
      if (type === 'registration') {
        const existingRegistration = otpStore.get(`registration:${email}`);
        if (existingRegistration) {
          // Update the OTP in existing registration data
          const newOtp = generateOTP();
          existingRegistration.otp = newOtp;
          existingRegistration.timestamp = Date.now();
          existingRegistration.expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
          
          otpStore.set(`registration:${email}`, existingRegistration);
          
          // Send new OTP email
          await sendOTPEmail(email, newOtp, type);
          
          logger.info('📧 Resending registration OTP', { email, type });
          
          return res.json({
            success: true,
            message: `New OTP sent to ${email}`,
            data: { email, type, otpSent: true }
          });
        }
      }

      const otp = generateOTP();
      
      // Store OTP with expiration (for non-registration types)
      const otpData = {
        otp,
        email,
        type,
        timestamp: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
      };

      otpStore.set(`${type}:${email}`, otpData);
      
      // Schedule cleanup
      setTimeout(() => otpStore.delete(`${type}:${email}`), 10 * 60 * 1000);

      // Send OTP email
      await sendOTPEmail(email, otp, type);

      logger.info('📧 Standalone OTP request', { email, type });

      res.json({
        success: true,
        message: `OTP sent to ${email}`,
        data: { email, type, otpSent: true }
      });
    } catch (error) {
      logger.error('❌ Send OTP failed:', error);
      next(error);
    }
  }

  /**
   * Refresh JWT token
   */
  static async refreshToken(req, res, next) {
    try {
      const { user } = req; // From auth middleware

      const token = generateToken({
        userId: user.id,
        email: user.email,
        tenantId: user.tenantId
      });

      res.json({
        success: true,
        data: { token }
      });
    } catch (error) {
      logger.error('❌ Token refresh failed:', error);
      next(error);
    }
  }

  /**
   * User logout
   */
  static async logout(req, res, next) {
    try {
      // In a stateless JWT system, logout is handled client-side
      // Could implement token blacklisting with Redis if needed
      
      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error) {
      logger.error('❌ Logout failed:', error);
      next(error);
    }
  }

  /**
   * Get current user profile
   */
  static async getProfile(req, res, next) {
    try {
      const { user } = req; // From auth middleware

      const userProfile = await executeWithRetry(
        () => prisma.user.findUnique({
          where: { id: user.id },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            emailVerified: true,
            createdAt: true,
            lastLoginAt: true
          }
        }),
        3
      );

      if (!userProfile) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      res.json({
        success: true,
        data: { user: userProfile }
      });
    } catch (error) {
      logger.error('❌ Get profile failed:', error);
      next(error);
    }
  }

  /**
   * Get current authenticated user information
   */
  static async getCurrentUser(req, res, next) {
    try {
      const { userId } = req.user; // From auth middleware

      // Get user with tenants
      const user = await executeWithRetry(
        () => prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            emailVerified: true,
            emailVerifiedAt: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true,
            tenants: {
              select: {
                id: true,
                tenantId: true,
                name: true,
                domain: true,
                status: true,
                createdAt: true
              }
            }
          }
        }),
        3
      );

      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'The authenticated user could not be found'
        });
      }

      logger.info('✅ Current user retrieved', { userId: user.id });

      res.json({
        success: true,
        message: 'User profile retrieved successfully',
        data: {
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            emailVerified: user.emailVerified,
            emailVerifiedAt: user.emailVerifiedAt,
            lastLoginAt: user.lastLoginAt,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
          },
          tenants: user.tenants,
          meta: {
            tenantCount: user.tenants.length,
            accountAge: Math.floor((new Date() - new Date(user.createdAt)) / (1000 * 60 * 60 * 24)) // days
          }
        }
      });
    } catch (error) {
      logger.error('❌ Get current user failed:', error);
      next(error);
    }
  }

  /**
   * Debug OTP store (development only)
   */
  static async debugOTPStore(req, res, next) {
    try {
      if (process.env.NODE_ENV !== 'development') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Debug endpoints only available in development'
        });
      }

      const { email } = req.query;
      
      if (email) {
        // Show OTPs for specific email (without actual OTP values)
        const registrationData = otpStore.get(`registration:${email}`);
        const otherOTPs = {};
        
        ['password_reset', 'email_verification'].forEach(type => {
          const data = otpStore.get(`${type}:${email}`);
          if (data) {
            otherOTPs[type] = {
              ...data,
              otp: '***' // Hide actual OTP
            };
          }
        });

        res.json({
          email,
          registrationData: registrationData ? {
            ...registrationData,
            otp: '***' // Hide actual OTP
          } : null,
          otherOTPs,
          loginAttempts: loginAttempts.get(email) || { count: 0 },
          otpAttempts: otpAttempts.get(`registration:${email}`) || { count: 0 },
          timestamp: new Date().toISOString()
        });
      } else {
        // Show all OTPs
        const allOTPs = {};
        for (const [key, value] of otpStore.entries()) {
          allOTPs[key] = {
            ...value,
            otp: '***' // Hide actual OTP for security
          };
        }

        res.json({
          totalOTPs: otpStore.size,
          otps: allOTPs,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('❌ Debug OTP store failed:', error);
      next(error);
    }
  }
}

module.exports = AuthController;