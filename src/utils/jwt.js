const jwt = require('jsonwebtoken');
const logger = require('./logger');

/**
 * Multi-tenant Website Builder - JWT Utility
 * Handles the generation and verification of JSON Web Tokens.
 */

/**
 * Generates a JWT for a given payload.
 * @param {object} payload - The payload to include in the token (e.g., { userId, email }).
 * @returns {string} The generated JWT.
 */
const generateToken = (payload) => {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

  if (!secret) {
    logger.error('JWT_SECRET is not defined. Cannot generate token.');
    throw new Error('Server configuration error: JWT secret is missing.');
  }

  return jwt.sign(payload, secret, { expiresIn });
};

module.exports = {
  generateToken,
};