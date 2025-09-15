const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// Import enhanced Prisma client
let prisma, executeWithRetry;
try {
  const dbModule = require('../lib/prisma');
  prisma = dbModule.prisma;
  executeWithRetry = dbModule.executeWithRetry;
  logger.info('✅ Enhanced Prisma client imported successfully in auth middleware');
} catch (error) {
  logger.error('❌ Failed to import enhanced Prisma client in auth middleware:', error);
}

/**
 * Middleware to authenticate JWT tokens from cookies or Authorization header
 */
const authenticateToken = async (req, res, next) => {
  try {
    let token = null;

    // Check for token in Authorization header (Bearer token)
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    // Check for token in HTTP-only cookie (fallback)
    if (!token && req.cookies && req.cookies.auth_token) {
      token = req.cookies.auth_token;
    }

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Access token is missing'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (!decoded.userId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token payload'
      });
    }

    // ✅ FIXED: Use enhanced Prisma client with retry mechanism
    const user = await executeWithRetry(
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
      3
    );

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not found'
      });
    }

    // Check if email is verified for protected routes
    if (!user.emailVerified) {
      return res.status(403).json({
        error: 'Email not verified',
        message: 'Please verify your email address to access this resource'
      });
    }

    // Attach user information to request object
    req.user = {
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      emailVerified: user.emailVerified,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt
    };

    logger.debug('User authenticated successfully', {
      userId: user.id,
      email: user.email,
      route: req.path
    });

    next();
  } catch (error) {
    // Handle different JWT error types
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid access token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Access token has expired. Please login again'
      });
    }

    logger.error('Authentication error:', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.userId || 'unknown'
    });

    return res.status(500).json({
      error: 'Authentication failed',
      message: 'An error occurred during authentication'
    });
  }
};

/**
 * Middleware to check if user has specific roles
 * @param {string[]} allowedRoles - Array of allowed roles
 */
const authorizeRoles = (allowedRoles = []) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated'
        });
      }

      if (allowedRoles.length === 0) {
        // No role restriction
        return next();
      }

      if (!allowedRoles.includes(req.user.role)) {
        logger.warn('Insufficient role permissions', {
          userId: req.user.userId,
          userRole: req.user.role,
          requiredRoles: allowedRoles,
          route: req.path
        });

        return res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to access this resource'
        });
      }

      next();
    } catch (error) {
      logger.error('Authorization error:', error);
      next(error);
    }
  };
};

/**
 * Optional authentication middleware - continues even if token is invalid
 * Useful for routes that work with both authenticated and anonymous users
 */
const optionalAuth = async (req, res, next) => {
  try {
    let token = null;

    // Check for token in Authorization header
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    // Check for token in cookies
    if (!token && req.cookies && req.cookies.auth_token) {
      token = req.cookies.auth_token;
    }

    if (!token) {
      // No token provided, continue as anonymous user
      req.user = null;
      return next();
    }

    try {
      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      if (decoded.userId) {
        // ✅ FIXED: Use enhanced Prisma client with retry mechanism
        const user = await executeWithRetry(
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
          3
        );

        if (user && user.emailVerified) {
          req.user = {
            userId: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            emailVerified: user.emailVerified,
            lastLoginAt: user.lastLoginAt,
            createdAt: user.createdAt
          };
        } else {
          req.user = null;
        }
      } else {
        req.user = null;
      }
    } catch (jwtError) {
      // Invalid token, continue as anonymous user
      req.user = null;
    }

    next();
  } catch (error) {
    logger.error('Optional authentication error:', error);
    // Don't fail the request, just continue as anonymous
    req.user = null;
    next();
  }
};

/**
 * Middleware to ensure user email is verified
 */
const requireEmailVerification = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  if (!req.user.emailVerified) {
    return res.status(403).json({
      error: 'Email verification required',
      message: 'Please verify your email address to access this resource',
      code: 'EMAIL_NOT_VERIFIED'
    });
  }

  next();
};

/**
 * Middleware to check if user is admin
 */
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Admin access required'
    });
  }

  next();
};

module.exports = {
  authenticateToken,
  authorizeRoles,
  optionalAuth,
  requireEmailVerification,
  requireAdmin
};
