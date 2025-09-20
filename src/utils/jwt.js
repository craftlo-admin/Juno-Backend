const jwt = require('jsonwebtoken');
const logger = require('./logger');

/**
 * Multi-tenant Website Builder - JWT Utility
 * Handles the generation and verification of JSON Web Tokens.
 */

/**
 * Validates JWT configuration
 * @returns {boolean} True if configuration is valid
 */
const validateJwtConfig = () => {
  const secret = process.env.JWT_SECRET;
  
  if (!secret) {
    logger.error('JWT_SECRET is not defined. Cannot generate/verify tokens.');
    return false;
  }

  if (secret.length < 32) {
    logger.warn('JWT_SECRET is too short. Recommend at least 32 characters.');
  }

  return true;
};

/**
 * Generates a JWT for a given payload.
 * @param {object} payload - The payload to include in the token (e.g., { userId, email }).
 * @param {string} [expiresIn] - Token expiration time (optional, defaults to env or 7d)
 * @returns {string} The generated JWT.
 */
const generateToken = (payload, expiresIn = null) => {
  if (!validateJwtConfig()) {
    throw new Error('Server configuration error: JWT configuration is invalid.');
  }

  // Validate payload
  if (!payload || typeof payload !== 'object') {
    throw new Error('JWT payload must be a valid object');
  }

  if (!payload.userId) {
    throw new Error('JWT payload must include userId');
  }

  const secret = process.env.JWT_SECRET;
  const expiry = expiresIn || process.env.JWT_EXPIRES_IN || '7d';

  // Add security metadata to payload
  const enhancedPayload = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    iss: 'website-builder-backend',
    aud: 'website-builder-app'
  };

  try {
    const token = jwt.sign(enhancedPayload, secret, { 
      expiresIn: expiry,
      algorithm: 'HS256' // Explicit algorithm specification for security
    });

    logger.debug('JWT token generated successfully', { 
      userId: payload.userId,
      expiresIn: expiry 
    });

    return token;
  } catch (error) {
    logger.error('JWT token generation failed:', error);
    throw new Error('Failed to generate authentication token');
  }
};

/**
 * Verifies a JWT token
 * @param {string} token - The JWT token to verify
 * @returns {object} The decoded payload if valid
 * @throws {Error} If token is invalid or expired
 */
const verifyToken = (token) => {
  if (!validateJwtConfig()) {
    throw new Error('Server configuration error: JWT configuration is invalid.');
  }

  if (!token || typeof token !== 'string') {
    throw new Error('Invalid token format');
  }

  const secret = process.env.JWT_SECRET;

  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'], // Explicit algorithm verification for security
      issuer: 'website-builder-backend',
      audience: 'website-builder-app'
    });

    logger.debug('JWT token verified successfully', { 
      userId: decoded.userId 
    });

    return decoded;
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      logger.warn('Invalid JWT token provided');
      throw new Error('Invalid token');
    }
    
    if (error.name === 'TokenExpiredError') {
      logger.warn('Expired JWT token provided');
      throw new Error('Token expired');
    }

    if (error.name === 'NotBeforeError') {
      logger.warn('JWT token used before valid time');
      throw new Error('Token not yet valid');
    }

    logger.error('JWT verification failed:', error);
    throw new Error('Token verification failed');
  }
};

/**
 * Decodes a JWT token without verification (useful for extracting expired token data)
 * @param {string} token - The JWT token to decode
 * @returns {object|null} The decoded payload or null if invalid
 */
const decodeToken = (token) => {
  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    return jwt.decode(token);
  } catch (error) {
    logger.warn('Failed to decode JWT token:', error);
    return null;
  }
};

/**
 * Generates a refresh token (longer-lived)
 * @param {object} payload - The payload to include in the refresh token
 * @returns {string} The generated refresh token
 */
const generateRefreshToken = (payload) => {
  return generateToken(payload, process.env.JWT_REFRESH_EXPIRES_IN || '30d');
};

module.exports = {
  generateToken,
  verifyToken,
  decodeToken,
  generateRefreshToken,
  validateJwtConfig
};