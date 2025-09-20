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
  // Validate input
  if (!name || typeof name !== 'string') {
    throw new Error('Tenant name must be a non-empty string');
  }

  // 1. Sanitize the name to be URL-friendly
  const sanitizedName = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with a single one
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

  // Ensure we have a meaningful name after sanitization
  const baseName = sanitizedName || 'tenant';
  
  // Ensure the base name isn't too long
  const truncatedName = baseName.length > 30 ? baseName.substring(0, 30) : baseName;

  // 2. Generate a short, unique suffix using nanoid
  // This prevents collisions if two tenants have the same sanitized name.
  const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);
  const uniqueSuffix = nanoid();

  // 3. Combine them for the final tenant ID
  const tenantId = `${truncatedName}-${uniqueSuffix}`;

  return tenantId;
};

/**
 * Generates a default subdomain for a new tenant based on its unique tenant ID.
 * Example: "my-tenant-a1b2c3d4" -> "my-tenant-a1b2c3d4.junotech.in"
 * @param {string} tenantId - The unique ID of the tenant.
 * @returns {string} The generated subdomain.
 */
const generateTenantDomain = (tenantId) => {
  // Use custom domain if enabled, otherwise fall back to BASE_DOMAIN
  const baseDomain = process.env.CUSTOM_DOMAIN_ENABLED === 'true' 
    ? process.env.CUSTOM_DOMAIN_BASE || 'junotech.in'
    : process.env.BASE_DOMAIN;
    
  if (!baseDomain) {
    throw new Error('Neither CUSTOM_DOMAIN_BASE nor BASE_DOMAIN is defined in environment variables.');
  }
  
  return `${tenantId}.${baseDomain}`;
};

/**
 * Generates a custom subdomain for CloudFront distribution aliases
 * Uses junotech.in as the base domain for custom subdomains
 * @param {string} tenantId - The unique ID of the tenant.
 * @returns {string|null} The generated custom domain or null if not enabled.
 */
const generateCustomDomain = (tenantId) => {
  if (process.env.CUSTOM_DOMAIN_ENABLED === 'true' && process.env.CUSTOM_DOMAIN_BASE) {
    return `${tenantId}.${process.env.CUSTOM_DOMAIN_BASE}`;
  }
  return null;
};

/**
 * Validates if a tenant ID is in the correct format
 * @param {string} tenantId - The tenant ID to validate
 * @returns {boolean} True if valid, false otherwise
 */
const isValidTenantId = (tenantId) => {
  if (!tenantId || typeof tenantId !== 'string') {
    return false;
  }
  
  // Check if it matches the expected format: lowercase letters, numbers, and hyphens
  const tenantIdRegex = /^[a-z0-9-]+$/;
  return tenantIdRegex.test(tenantId) && tenantId.length > 3 && tenantId.length < 100;
};

module.exports = {
  generateTenantId,
  generateTenantDomain,
  generateCustomDomain,
  isValidTenantId,
};
