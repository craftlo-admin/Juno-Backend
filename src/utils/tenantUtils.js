const crypto = require('crypto');
const logger = require('./logger');
const { customAlphabet } = require('nanoid');

let prisma = null;

// Safely import Prisma
try {
  prisma = require('../lib/prisma');
} catch (error) {
  logger.warn('Prisma not available in tenantUtils, using fallback methods');
}

/**
 * Multi-tenant Website Builder - Tenant Utilities
 * Provides helper functions for tenant management, such as generating unique IDs and domains.
 * Follows production-ready standards for creating predictable and safe identifiers.
 */

/**
 * Generates a unique, URL-safe tenant ID from a given name.
 * Example: "John's Organization" -> "johns-organization-a1b2c3d4"
 * @param {string} name - The name of the tenant or organization.
 * @returns {Promise<string>} A unique and URL-friendly tenant ID.
 */
const generateTenantId = async (name) => {
  // 1. Sanitize the name to be URL-friendly
  const sanitizedName = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-'); // Replace multiple hyphens with a single one

  // 2. Generate a short, unique suffix using nanoid
  // This prevents collisions if two tenants have the same sanitized name.
  const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);
  const uniqueSuffix = nanoid();

  // 3. Combine them for the final tenant ID
  const tenantId = `${sanitizedName}-${uniqueSuffix}`;

  return tenantId;
};

/**
 * Generates a default subdomain for a new tenant based on its unique tenant ID.
 * Example: "my-tenant-a1b2c3d4" -> "my-tenant-a1b2c3d4.yourapp.com"
 * @param {string} tenantId - The unique ID of the tenant.
 * @returns {string} The generated subdomain.
 */
const generateTenantDomain = (tenantId) => {
  const baseDomain = process.env.BASE_DOMAIN;
  if (!baseDomain) {
    throw new Error('BASE_DOMAIN is not defined in the environment variables.');
  }
  return `${tenantId}.${baseDomain}`;
};

module.exports = {
  generateTenantId,
  generateTenantDomain,
};
