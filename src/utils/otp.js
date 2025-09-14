const crypto = require('crypto');

/**
 * Multi-tenant Website Builder - OTP Utility
 * Generates secure, time-based One-Time Passwords.
 * Follows production-ready standards for security.
 */

/**
 * Generates a secure 6-digit numeric OTP.
 * @returns {string} A 6-digit OTP string.
 */
const generateOTP = () => {
  // Using crypto for a more secure random number than Math.random()
  return crypto.randomInt(100000, 1000000).toString();
};

module.exports = {
  generateOTP,
};