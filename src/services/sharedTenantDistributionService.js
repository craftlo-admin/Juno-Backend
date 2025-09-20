const AWS = require('aws-sdk');
const logger = require('../utils/logger');
const { prisma } = require('../lib/prisma');

// Configure AWS CloudFront
const cloudFront = new AWS.CloudFront({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

/**
 * Shared Tenant Distribution Service
 * Manages tenant operations on the shared CloudFront distribution
 */
class SharedTenantDistributionService {
  
  constructor() {
    this.sharedDistributionId = process.env.SHARED_CLOUDFRONT_DISTRIBUTION_ID || 'E21LRYPVGD34E4';
    this.customDomainBase = process.env.CUSTOM_DOMAIN_BASE || 'junotech.in';
    this.sharedDistributionDomain = process.env.SHARED_CLOUDFRONT_DOMAIN;
  }

  /**
   * Get or setup tenant domain configuration for shared distribution
   * @param {string} tenantId - Tenant identifier
   * @returns {Object} - Tenant domain configuration
   */
  async getOrSetupTenantDomain(tenantId) {
    try {
      logger.info(`Getting/setting up tenant domain for shared distribution`, { tenantId });

      // For shared distribution, all tenants use the same CloudFront distribution
      // The routing is handled by the CloudFront Function
      const tenantDomain = `${tenantId}.${this.customDomainBase}`;
      const cloudFrontDomain = this.sharedDistributionDomain || `${this.sharedDistributionId}.cloudfront.net`;

      const domainConfig = {
        distributionId: this.sharedDistributionId,
        tenantDomain: tenantDomain,
        cloudFrontDomain: cloudFrontDomain,
        type: 'shared'
      };

      logger.info('Tenant domain configured for shared distribution', {
        tenantId,
        ...domainConfig
      });

      return domainConfig;

    } catch (error) {
      logger.error('Failed to get/setup tenant domain for shared distribution', {
        tenantId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get tenant domain configuration (without setup)
   * @param {string} tenantId - Tenant identifier
   * @returns {Object} - Tenant domain configuration
   */
  async getTenantDomain(tenantId) {
    try {
      logger.info(`Getting tenant domain for shared distribution`, { tenantId });

      const tenantDomain = `${tenantId}.${this.customDomainBase}`;
      const cloudFrontDomain = this.sharedDistributionDomain || `${this.sharedDistributionId}.cloudfront.net`;

      return {
        distributionId: this.sharedDistributionId,
        tenantDomain: tenantDomain,
        cloudFrontDomain: cloudFrontDomain,
        type: 'shared'
      };

    } catch (error) {
      logger.error('Failed to get tenant domain for shared distribution', {
        tenantId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Invalidate tenant cache on shared distribution
   * @param {string} tenantId - Tenant identifier
   * @param {string} buildId - Optional build ID for logging
   * @returns {string} - Invalidation ID
   */
  async invalidateTenantCache(tenantId, buildId = null) {
    try {
      logger.info('Creating CloudFront invalidation for tenant on shared distribution', {
        tenantId,
        buildId,
        distributionId: this.sharedDistributionId
      });

      // For shared distribution, we invalidate the tenant's specific path
      const paths = [
        `/tenants/${tenantId}/deployments/current/*`,
        `/tenants/${tenantId}/deployments/current/index.html`,
        `/tenants/${tenantId}/deployments/current/`
      ];

      const invalidationParams = {
        DistributionId: this.sharedDistributionId,
        InvalidationBatch: {
          CallerReference: `tenant-${tenantId}-${Date.now()}`,
          Paths: {
            Quantity: paths.length,
            Items: paths
          }
        }
      };

      const result = await cloudFront.createInvalidation(invalidationParams).promise();
      const invalidationId = result.Invalidation.Id;

      logger.info('CloudFront invalidation created for tenant on shared distribution', {
        tenantId,
        buildId,
        invalidationId,
        distributionId: this.sharedDistributionId,
        paths
      });

      return invalidationId;

    } catch (error) {
      logger.error('Failed to create CloudFront invalidation for tenant on shared distribution', {
        tenantId,
        buildId,
        distributionId: this.sharedDistributionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get shared distribution information
   * @returns {Object} - Distribution configuration
   */
  async getSharedDistributionInfo() {
    try {
      const result = await cloudFront.getDistribution({
        Id: this.sharedDistributionId
      }).promise();

      return {
        distributionId: this.sharedDistributionId,
        domainName: result.Distribution.DomainName,
        status: result.Distribution.Status,
        enabled: result.Distribution.DistributionConfig.Enabled
      };

    } catch (error) {
      logger.error('Failed to get shared distribution info', {
        distributionId: this.sharedDistributionId,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = SharedTenantDistributionService;