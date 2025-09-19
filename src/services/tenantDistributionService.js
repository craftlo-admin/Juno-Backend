const AWS = require('aws-sdk');
const logger = require('../utils/logger');
const { prisma } = require('../lib/prisma');

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const cloudFront = new AWS.CloudFront();

/**
 * Tenant Distribution Service - Manages individual CloudFront distributions per tenant
 * Each tenant gets their own CloudFront distribution with a unique subdomain
 */
class TenantDistributionService {
  
  /**
   * Create a new CloudFront distribution for a tenant
   * @param {string} tenantId - Unique tenant identifier
   * @returns {Object} - Distribution details with unique domain
   */
  static async createTenantDistribution(tenantId) {
    try {
      logger.info('Creating CloudFront distribution for tenant', { tenantId });
      
      // Generate unique distribution identifier
      const uniqueId = this.generateUniqueId(tenantId);
      const callerReference = `tenant-${tenantId}-${Date.now()}`;
      
      const distributionConfig = {
        CallerReference: callerReference,
        Comment: `Distribution for tenant: ${tenantId}`,
        Enabled: true,
        PriceClass: 'PriceClass_100', // Cheapest option
        
        // Origins configuration
        Origins: {
          Quantity: 1,
          Items: [{
            Id: `${tenantId}-s3-origin`,
            DomainName: `${process.env.AWS_S3_BUCKET_STATIC}.s3.amazonaws.com`,
            OriginPath: `/tenants/${tenantId}`,
            CustomOriginConfig: {
              HTTPPort: 80,
              HTTPSPort: 443,
              OriginProtocolPolicy: 'https-only',
              OriginSslProtocols: {
                Quantity: 1,
                Items: ['TLSv1.2']
              }
            }
          }]
        },
        
        // Default cache behavior
        DefaultCacheBehavior: {
          TargetOriginId: `${tenantId}-s3-origin`,
          ViewerProtocolPolicy: 'redirect-to-https',
          MinTTL: 0,
          DefaultTTL: 86400,
          MaxTTL: 31536000,
          AllowedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD'],
            CachedMethods: {
              Quantity: 2,
              Items: ['GET', 'HEAD']
            }
          },
          ForwardedValues: {
            QueryString: false,
            Cookies: { Forward: 'none' }
          },
          TrustedSigners: {
            Enabled: false,
            Quantity: 0
          }
        },
        
        // Custom error pages
        CustomErrorResponses: {
          Quantity: 2,
          Items: [
            {
              ErrorCode: 404,
              ResponsePagePath: '/index.html',
              ResponseCode: '200',
              ErrorCachingMinTTL: 300
            },
            {
              ErrorCode: 403,
              ResponsePagePath: '/index.html', 
              ResponseCode: '200',
              ErrorCachingMinTTL: 300
            }
          ]
        }
      };
      
      logger.info('Creating CloudFront distribution with config', { 
        tenantId, 
        callerReference,
        originPath: `/tenants/${tenantId}`
      });
      
      const result = await cloudFront.createDistribution({
        DistributionConfig: distributionConfig
      }).promise();
      
      const distribution = result.Distribution;
      const distributionDomain = distribution.DomainName;
      
      logger.info('CloudFront distribution created successfully', {
        tenantId,
        distributionId: distribution.Id,
        domain: distributionDomain,
        status: distribution.Status
      });
      
      // Store distribution details in database
      await this.storeTenantDistribution(tenantId, {
        distributionId: distribution.Id,
        domain: distributionDomain,
        status: distribution.Status,
        uniqueId: uniqueId
      });
      
      return {
        distributionId: distribution.Id,
        domain: distributionDomain,
        status: distribution.Status,
        uniqueId: uniqueId,
        deploymentUrl: `https://${distributionDomain}`
      };
      
    } catch (error) {
      logger.error('Failed to create CloudFront distribution for tenant', {
        tenantId,
        error: error.message,
        code: error.code
      });
      throw new Error(`CloudFront distribution creation failed: ${error.message}`);
    }
  }
  
  /**
   * Get or create CloudFront distribution for tenant
   * @param {string} tenantId - Tenant identifier
   * @returns {Object} - Distribution details
   */
  static async getOrCreateTenantDistribution(tenantId) {
    try {
      // Check if tenant already has a distribution
      const existingDistribution = await this.getTenantDistribution(tenantId);
      
      if (existingDistribution) {
        logger.info('Using existing CloudFront distribution for tenant', {
          tenantId,
          distributionId: existingDistribution.distributionId,
          domain: existingDistribution.domain
        });
        return existingDistribution;
      }
      
      // Create new distribution if none exists
      logger.info('Creating new CloudFront distribution for tenant', { tenantId });
      return await this.createTenantDistribution(tenantId);
      
    } catch (error) {
      logger.error('Failed to get or create tenant distribution', {
        tenantId,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Get existing CloudFront distribution for tenant
   * @param {string} tenantId - Tenant identifier
   * @returns {Object|null} - Distribution details or null
   */
  static async getTenantDistribution(tenantId) {
    try {
      // Check database for existing distribution
      const tenant = await prisma.tenant.findUnique({
        where: { tenantId: tenantId },
        select: {
          cloudfrontDistributionId: true,
          cloudfrontDomain: true,
          cloudfrontStatus: true,
          cloudfrontUniqueId: true,
          cloudfrontCreatedAt: true
        }
      });
      
      if (!tenant || !tenant.cloudfrontDistributionId) {
        return null;
      }
      
      // Verify distribution still exists in AWS
      try {
        const awsDistribution = await cloudFront.getDistribution({
          Id: tenant.cloudfrontDistributionId
        }).promise();
        
        return {
          distributionId: tenant.cloudfrontDistributionId,
          domain: tenant.cloudfrontDomain || awsDistribution.Distribution.DomainName,
          status: awsDistribution.Distribution.Status,
          deploymentUrl: `https://${tenant.cloudfrontDomain || awsDistribution.Distribution.DomainName}`
        };
        
      } catch (awsError) {
        if (awsError.code === 'NoSuchDistribution') {
          logger.warn('CloudFront distribution not found in AWS, will create new one', {
            tenantId,
            distributionId: tenant.cloudfrontDistributionId
          });
          
          // Clean up stale database reference
          await this.clearTenantDistribution(tenantId);
          return null;
        }
        throw awsError;
      }
      
    } catch (error) {
      logger.error('Failed to get tenant distribution', {
        tenantId,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Store tenant distribution details in database
   * @param {string} tenantId - Tenant identifier
   * @param {Object} distributionData - Distribution details
   */
  static async storeTenantDistribution(tenantId, distributionData) {
    try {
      await prisma.tenant.update({
        where: { tenantId: tenantId },
        data: {
          cloudfrontDistributionId: distributionData.distributionId,
          cloudfrontDomain: distributionData.domain,
          cloudfrontStatus: distributionData.status,
          cloudfrontUniqueId: distributionData.uniqueId,
          cloudfrontCreatedAt: new Date()
        }
      });
      
      logger.info('Tenant distribution details stored in database', {
        tenantId,
        distributionId: distributionData.distributionId
      });
      
    } catch (error) {
      logger.error('Failed to store tenant distribution details', {
        tenantId,
        error: error.message
      });
      // Don't throw here - distribution was created successfully
    }
  }
  
  /**
   * Clear tenant distribution details from database
   * @param {string} tenantId - Tenant identifier
   */
  static async clearTenantDistribution(tenantId) {
    try {
      await prisma.tenant.update({
        where: { tenantId: tenantId },
        data: {
          cloudfrontDistributionId: null,
          cloudfrontDomain: null,
          cloudfrontStatus: null,
          cloudfrontUniqueId: null,
          cloudfrontCreatedAt: null
        }
      });
      
      logger.info('Tenant distribution details cleared from database', { tenantId });
      
    } catch (error) {
      logger.error('Failed to clear tenant distribution details', {
        tenantId,
        error: error.message
      });
    }
  }
  
  /**
   * Invalidate CloudFront cache for tenant's distribution
   * @param {string} tenantId - Tenant identifier
   * @param {string} buildId - Optional specific build to invalidate
   * @returns {string|null} - Invalidation ID or null
   */
  static async invalidateTenantCache(tenantId, buildId = null) {
    try {
      const distribution = await this.getTenantDistribution(tenantId);
      
      if (!distribution) {
        logger.warn('No CloudFront distribution found for tenant, skipping invalidation', {
          tenantId
        });
        return null;
      }
      
      const invalidationPaths = buildId ? [
        `/deployments/${buildId}/*`,
        `/current/*`
      ] : [
        `/deployments/*`,
        `/current/*`
      ];
      
      const params = {
        DistributionId: distribution.distributionId,
        InvalidationBatch: {
          Paths: {
            Quantity: invalidationPaths.length,
            Items: invalidationPaths
          },
          CallerReference: `${tenantId}-${Date.now()}`
        }
      };
      
      const result = await cloudFront.createInvalidation(params).promise();
      
      logger.info('CloudFront cache invalidation created for tenant', {
        tenantId,
        distributionId: distribution.distributionId,
        invalidationId: result.Invalidation.Id,
        paths: invalidationPaths
      });
      
      return result.Invalidation.Id;
      
    } catch (error) {
      logger.error('Failed to invalidate CloudFront cache for tenant', {
        tenantId,
        error: error.message
      });
      // Return null instead of throwing to prevent build failures
      return null;
    }
  }
  
  /**
   * Generate unique identifier for tenant distribution
   * @param {string} tenantId - Tenant identifier
   * @returns {string} - Unique identifier
   */
  static generateUniqueId(tenantId) {
    // Create a unique identifier combining tenant ID with timestamp
    const timestamp = Date.now().toString(36);
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    return `${tenantId.substring(0, 8)}-${timestamp}-${randomSuffix}`;
  }
  
  /**
   * Delete CloudFront distribution for tenant (cleanup)
   * @param {string} tenantId - Tenant identifier
   * @returns {boolean} - Success status
   */
  static async deleteTenantDistribution(tenantId) {
    try {
      const distribution = await this.getTenantDistribution(tenantId);
      
      if (!distribution) {
        logger.info('No CloudFront distribution found for tenant, nothing to delete', {
          tenantId
        });
        return true;
      }
      
      // First disable the distribution
      logger.info('Disabling CloudFront distribution for tenant', {
        tenantId,
        distributionId: distribution.distributionId
      });
      
      const getConfigResult = await cloudFront.getDistributionConfig({
        Id: distribution.distributionId
      }).promise();
      
      const config = getConfigResult.DistributionConfig;
      config.Enabled = false;
      
      await cloudFront.updateDistribution({
        Id: distribution.distributionId,
        DistributionConfig: config,
        IfMatch: getConfigResult.ETag
      }).promise();
      
      logger.info('CloudFront distribution disabled for tenant', {
        tenantId,
        distributionId: distribution.distributionId
      });
      
      // Note: Actual deletion requires the distribution to be disabled and deployed first
      // This is a two-step process in CloudFront
      
      return true;
      
    } catch (error) {
      logger.error('Failed to delete CloudFront distribution for tenant', {
        tenantId,
        error: error.message
      });
      return false;
    }
  }
}

module.exports = TenantDistributionService;