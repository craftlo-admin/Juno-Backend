const AWS = require('aws-sdk');
const logger = require('../utils/logger');
const { prisma } = require('../lib/prisma');
const DNSService = require('./dnsService');
const CloudFrontConflictResolver = require('./cloudFrontConflictResolver');

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
  
  constructor() {
    this.dnsService = new DNSService();
    this.conflictResolver = new CloudFrontConflictResolver();
  }
  
  /**
   * Create a new CloudFront distribution for a tenant
   * @param {string} tenantId - Unique tenant identifier
   * @returns {Object} - Distribution details with unique domain
   */
  static async createTenantDistribution(tenantId) {
    const instance = new TenantDistributionService();
    return instance._createTenantDistribution(tenantId);
  }

  async _createTenantDistribution(tenantId) {
    try {
      logger.info('Creating CloudFront distribution for tenant', { tenantId });
      
      // Generate unique distribution identifier
      const uniqueId = TenantDistributionService.generateUniqueId(tenantId);
      const callerReference = `tenant-${tenantId}-${Date.now()}`;
      
      // Generate custom subdomain for tenant
      let tenantCustomDomain = TenantDistributionService.generateTenantSubdomain(tenantId);
      let resolutionStrategy = null;
      let shouldCreateDNSFirst = false;
      
      // Check for CNAME conflicts and resolve if necessary
      if (tenantCustomDomain) {
        const conflictCheck = await this.conflictResolver.checkCNAMEConflict(tenantCustomDomain);
        
        if (conflictCheck.hasConflict) {
          logger.warn('CNAME conflict detected, applying resolution strategy', {
            tenantId,
            originalDomain: tenantCustomDomain,
            conflictInfo: conflictCheck
          });
          
          resolutionStrategy = await this.conflictResolver.resolveCNAMEConflict(
            tenantId, 
            tenantCustomDomain, 
            conflictCheck
          );
          
          if (resolutionStrategy.strategy === 'reuse_existing') {
            logger.info('Reusing existing distribution for tenant', {
              tenantId,
              distributionId: resolutionStrategy.distributionId,
              domain: resolutionStrategy.domain
            });
            
            // Store the reused distribution in database
            await this.storeTenantDistribution(tenantId, {
              distributionId: resolutionStrategy.distributionId,
              domain: resolutionStrategy.domain,
              cloudfrontDomain: resolutionStrategy.cloudfrontDomain,
              customDomain: resolutionStrategy.domain,
              status: 'Deployed',
              uniqueId: uniqueId,
              strategy: resolutionStrategy.strategy
            });
            
            // Return existing distribution details
            return {
              distributionId: resolutionStrategy.distributionId,
              domain: resolutionStrategy.domain,
              customDomain: resolutionStrategy.domain,
              status: 'Deployed',
              strategy: resolutionStrategy.strategy,
              message: resolutionStrategy.message
            };
          } else if (resolutionStrategy.strategy === 'alternative_cname') {
            tenantCustomDomain = resolutionStrategy.domain;
            shouldCreateDNSFirst = true;
            logger.info('Using alternative CNAME to avoid conflict', {
              tenantId,
              originalDomain: TenantDistributionService.generateTenantSubdomain(tenantId),
              alternativeDomain: tenantCustomDomain
            });
          } else if (resolutionStrategy.strategy === 'cloudfront_only') {
            tenantCustomDomain = null;
            logger.info('Creating distribution without custom CNAME due to conflicts', {
              tenantId,
              strategy: resolutionStrategy.strategy
            });
          }
        } else {
          // No conflict detected, safe to create DNS first
          shouldCreateDNSFirst = true;
        }
      }

      // Step 1: Create CloudFront distribution WITHOUT custom domain first to avoid conflicts
      let dnsChangeId = null;
      
      logger.info('Creating CloudFront distribution without custom domain first to avoid conflicts', {
        tenantId,
        willAddCustomDomain: !!tenantCustomDomain
      });
      
      const distributionConfig = {
        CallerReference: callerReference,
        Comment: `Distribution for tenant: ${tenantId}`,
        Enabled: true,
        PriceClass: 'PriceClass_100', // Cheapest option
        
        // Include custom domain aliases if available
        Aliases: tenantCustomDomain ? {
          Quantity: 1,
          Items: [tenantCustomDomain]
        } : {
          Quantity: 0,
          Items: []
        },
        
        // SSL certificate configuration
        ViewerCertificate: tenantCustomDomain ? {
          ACMCertificateArn: process.env.SSL_CERTIFICATE_ARN,
          SSLSupportMethod: 'sni-only',
          MinimumProtocolVersion: 'TLSv1.2_2021',
          CertificateSource: 'acm'
        } : {
          CloudFrontDefaultCertificate: true
        },
        
        // Origins configuration
        Origins: {
          Quantity: 1,
          Items: [{
            Id: `${tenantId}-s3-origin`,
            DomainName: `${process.env.AWS_S3_BUCKET_STATIC}.s3.amazonaws.com`,
            OriginPath: `/tenants/${tenantId}`,
            S3OriginConfig: {
              OriginAccessIdentity: ''
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
              ResponsePagePath: '/deployments/current/index.html',
              ResponseCode: '200',
              ErrorCachingMinTTL: 300
            },
            {
              ErrorCode: 403,
              ResponsePagePath: '/deployments/current/index.html', 
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
      const customSubdomain = TenantDistributionService.generateTenantSubdomain(tenantId);
      
      logger.info('CloudFront distribution created successfully', {
        tenantId,
        distributionId: distribution.Id,
        cloudfrontDomain: distributionDomain,
        customDomain: customSubdomain,
        status: distribution.Status
      });

      // Create custom domain DNS record AFTER CloudFront distribution is created
      let finalCustomDomain = tenantCustomDomain; // The custom domain we want to use
      
      if (finalCustomDomain && this.dnsService.enabled) {
        try {
          logger.info('Creating DNS record to point to CloudFront distribution', {
            tenantId,
            customDomain: finalCustomDomain,
            cloudfrontTarget: distributionDomain
          });
          
          // Create DNS record pointing to the actual CloudFront distribution
          dnsChangeId = await this.dnsService.createTenantDNSRecord(tenantId, distributionDomain);
          if (dnsChangeId) {
            logger.info('DNS record created successfully after CloudFront distribution', {
              tenantId,
              subdomain: finalCustomDomain,
              changeId: dnsChangeId,
              target: distributionDomain
            });
          }
        } catch (dnsError) {
          logger.warn('Failed to create DNS record after CloudFront distribution creation', {
            tenantId,
            customDomain: finalCustomDomain,
            error: dnsError.message
          });
          // Continue without custom domain - fallback to CloudFront domain only
          finalCustomDomain = null;
        }
      }
      
      // Use final custom domain for the primary domain if available
      const primaryDomain = finalCustomDomain || distributionDomain;
      
      // Store distribution details in database
      await this.storeTenantDistribution(tenantId, {
        distributionId: distribution.Id,
        domain: primaryDomain,
        cloudfrontDomain: distributionDomain,
        customDomain: finalCustomDomain,
        status: distribution.Status,
        uniqueId: uniqueId,
        dnsChangeId: dnsChangeId
      });
      
      return {
        distributionId: distribution.Id,
        domain: primaryDomain,
        cloudfrontDomain: distributionDomain,
        customDomain: finalCustomDomain,
        status: distribution.Status,
        uniqueId: uniqueId,
        deploymentUrl: `https://${primaryDomain}`
      };
      
    } catch (error) {
      logger.error('Failed to create CloudFront distribution for tenant', {
        tenantId,
        error: error.message,
        code: error.code
      });

      // Handle CNAME conflict errors specifically with enhanced retry logic
      if (error.message && error.message.includes('incorrectly configured DNS record')) {
        logger.warn('CNAME conflict detected in error, applying intelligent resolution', {
          tenantId,
          error: error.message
        });

        // Try the conflict resolver with the error context
        const tenantCustomDomain = TenantDistributionService.generateTenantSubdomain(tenantId);
        
        try {
          logger.info('Attempting conflict resolution with error context', { tenantId });
          
          const conflictInfo = {
            hasConflict: true,
            domain: tenantCustomDomain,
            conflictType: 'dns_mismatch',
            errorMessage: error.message
          };
          
          const resolutionStrategy = await this.conflictResolver.resolveCNAMEConflict(
            tenantId, 
            tenantCustomDomain, 
            conflictInfo
          );
          
          if (resolutionStrategy.strategy === 'reuse_existing') {
            logger.info('Reusing existing distribution after conflict detection', {
              tenantId,
              distributionId: resolutionStrategy.distributionId
            });
            
            // Store the reused distribution in database
            await this.storeTenantDistribution(tenantId, {
              distributionId: resolutionStrategy.distributionId,
              domain: resolutionStrategy.domain,
              cloudfrontDomain: resolutionStrategy.cloudfrontDomain,
              customDomain: resolutionStrategy.domain,
              status: 'Deployed',
              uniqueId: TenantDistributionService.generateUniqueId(tenantId),
              strategy: 'reuse_existing',
              resolvedConflict: true
            });
            
            return {
              distributionId: resolutionStrategy.distributionId,
              domain: resolutionStrategy.domain,
              customDomain: resolutionStrategy.domain,
              status: 'Deployed',
              strategy: 'reuse_existing',
              message: 'Reused existing distribution to resolve conflict'
            };
          } else if (resolutionStrategy.strategy === 'alternative_cname') {
            logger.info('Retrying with alternative CNAME after conflict', {
              tenantId,
              alternativeDomain: resolutionStrategy.domain,
              remainingRetries: maxDepth - 1
            });
            
            // Retry with alternative domain - recursive call with new domain and reduced depth
            return await this._createTenantDistributionWithDomain(
              tenantId, 
              resolutionStrategy.domain, 
              true, // isRetry flag
              maxDepth - 1 // Reduce depth to prevent infinite recursion
            );
          }
          
        } catch (resolutionError) {
          logger.warn('Conflict resolution failed, proceeding to emergency fallback', {
            tenantId,
            resolutionError: resolutionError.message
          });
        }

        // Emergency fallback: Create distribution without custom CNAME
        logger.info('Creating emergency fallback CloudFront distribution', { tenantId });
        
        try {
          // Emergency fallback: Create distribution without custom CNAME
          const fallbackConfig = {
            CallerReference: `fallback-${tenantId}-${Date.now()}`,
            Comment: `Fallback distribution for tenant: ${tenantId} (no custom domain)`,
            Enabled: true,
            PriceClass: 'PriceClass_100',
            
            // No custom domain aliases
            Aliases: {
              Quantity: 0,
              Items: []
            },
            
            // Default CloudFront certificate
            ViewerCertificate: {
              CloudFrontDefaultCertificate: true
            },
            
            // Origins configuration (same as before)
            Origins: {
              Quantity: 1,
              Items: [{
                Id: `${tenantId}-s3-origin`,
                DomainName: `${process.env.AWS_S3_BUCKET_STATIC}.s3.amazonaws.com`,
                OriginPath: `/tenants/${tenantId}`,
                S3OriginConfig: {
                  OriginAccessIdentity: ''
                }
              }]
            },
            
            // Default cache behavior (same as before)
            DefaultCacheBehavior: {
              TargetOriginId: `${tenantId}-s3-origin`,
              ViewerProtocolPolicy: 'redirect-to-https',
              MinTTL: 0,
              DefaultTTL: 86400,
              MaxTTL: 31536000,
              AllowedMethods: {
                Quantity: 7,
                Items: ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
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
                Quantity: 0,
                Items: []
              }
            }
          };

          logger.info('Creating fallback CloudFront distribution without custom domain', {
            tenantId
          });

          const fallbackResult = await cloudFront.createDistribution({
            DistributionConfig: fallbackConfig
          }).promise();

          const fallbackDistribution = fallbackResult.Distribution;

          logger.info('Fallback CloudFront distribution created successfully', {
            tenantId,
            distributionId: fallbackDistribution.Id,
            cloudfrontDomain: fallbackDistribution.DomainName,
            customDomain: null,
            status: fallbackDistribution.Status,
            note: 'Created without custom domain due to CNAME conflict'
          });

          // Store fallback distribution details
          await this.storeTenantDistribution(tenantId, {
            distributionId: fallbackDistribution.Id,
            domain: fallbackDistribution.DomainName,
            cloudfrontDomain: fallbackDistribution.DomainName,
            customDomain: null,
            status: fallbackDistribution.Status,
            uniqueId: TenantDistributionService.generateUniqueId(tenantId),
            dnsChangeId: null,
            fallback: true,
            conflictReason: 'CNAME conflict detected'
          });

          return {
            distributionId: fallbackDistribution.Id,
            domain: fallbackDistribution.DomainName,
            cloudfrontDomain: fallbackDistribution.DomainName,
            customDomain: null,
            status: fallbackDistribution.Status,
            uniqueId: TenantDistributionService.generateUniqueId(tenantId),
            deploymentUrl: `https://${fallbackDistribution.DomainName}`,
            fallback: true,
            warning: 'Custom domain unavailable due to conflict, using CloudFront domain'
          };

        } catch (fallbackError) {
          logger.error('Fallback distribution creation also failed', {
            tenantId,
            originalError: error.message,
            fallbackError: fallbackError.message
          });
          throw new Error(`CloudFront distribution creation failed: ${error.message}. Fallback also failed: ${fallbackError.message}`);
        }
      }

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
          cloudfrontCreatedAt: true,
          customDomain: true,
          primaryDomain: true
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
          domain: tenant.primaryDomain || tenant.cloudfrontDomain || awsDistribution.Distribution.DomainName,
          cloudfrontDomain: tenant.cloudfrontDomain || awsDistribution.Distribution.DomainName,
          customDomain: tenant.customDomain,
          status: awsDistribution.Distribution.Status,
          deploymentUrl: `https://${tenant.primaryDomain || tenant.cloudfrontDomain || awsDistribution.Distribution.DomainName}`
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
  async storeTenantDistribution(tenantId, distributionData) {
    try {
      await prisma.tenant.update({
        where: { tenantId: tenantId },
        data: {
          cloudfrontDistributionId: distributionData.distributionId,
          cloudfrontDomain: distributionData.cloudfrontDomain,
          cloudfrontStatus: distributionData.status,
          cloudfrontUniqueId: distributionData.uniqueId,
          cloudfrontCreatedAt: new Date(),
          customDomain: distributionData.customDomain,
          primaryDomain: distributionData.domain
        }
      });
      
      logger.info('Tenant distribution details stored in database', {
        tenantId,
        distributionId: distributionData.distributionId,
        customDomain: distributionData.customDomain,
        primaryDomain: distributionData.domain
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
          cloudfrontCreatedAt: null,
          customDomain: null,
          primaryDomain: null
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
   * Generate custom subdomain for tenant using junotech.in
   * @param {string} tenantId - Tenant identifier
   * @returns {string} - Custom subdomain (e.g., "tenant123.junotech.in")
   */
  static generateTenantSubdomain(tenantId) {
    if (process.env.CUSTOM_DOMAIN_ENABLED === 'true' && process.env.CUSTOM_DOMAIN_BASE) {
      return `${tenantId}.${process.env.CUSTOM_DOMAIN_BASE}`;
    }
    // Fallback to default CloudFront domain behavior
    return null;
  }

  /**
   * Get custom domain aliases configuration for CloudFront
   * @param {string} customDomain - Custom domain (e.g., "tenant123.junotech.in")
   * @returns {Object} - Aliases configuration
   */
  static getCustomDomainAliases(customDomain) {
    if (customDomain) {
      return {
        Quantity: 1,
        Items: [customDomain]
      };
    }
    return {
      Quantity: 0,
      Items: []
    };
  }

  /**
   * Get SSL certificate configuration for custom domain
   * @returns {Object} - ViewerCertificate configuration
   */
  static getViewerCertificateConfig() {
    if (process.env.CUSTOM_DOMAIN_ENABLED === 'true' && process.env.SSL_CERTIFICATE_ARN) {
      return {
        ACMCertificateArn: process.env.SSL_CERTIFICATE_ARN,
        SSLSupportMethod: 'sni-only',
        MinimumProtocolVersion: 'TLSv1.2_2021',
        CertificateSource: 'acm'
      };
    }
    
    // Fallback to default CloudFront SSL certificate
    return {
      CloudFrontDefaultCertificate: true,
      MinimumProtocolVersion: 'TLSv1.2_2021'
    };
  }
  
  /**
   * Delete CloudFront distribution for tenant (cleanup)
   * @param {string} tenantId - Tenant identifier
   * @returns {boolean} - Success status
   */
  static async deleteTenantDistribution(tenantId) {
    const instance = new TenantDistributionService();
    return instance._deleteTenantDistribution(tenantId);
  }

  async _deleteTenantDistribution(tenantId) {
    try {
      const distribution = await TenantDistributionService.getTenantDistribution(tenantId);
      
      if (!distribution) {
        logger.info('No CloudFront distribution found for tenant, nothing to delete', {
          tenantId
        });
        return true;
      }

      // Delete DNS record if Route 53 is enabled
      if (distribution.cloudfrontDomain && this.dnsService.enabled) {
        try {
          await this.dnsService.deleteTenantDNSRecord(tenantId, distribution.cloudfrontDomain);
          logger.info('DNS record deletion initiated for tenant', {
            tenantId,
            customDomain: distribution.customDomain
          });
        } catch (dnsError) {
          logger.error('Failed to delete DNS record, continuing with distribution deletion', {
            tenantId,
            error: dnsError.message
          });
        }
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

  /**
   * Create tenant distribution with specific custom domain (for retries)
   * @param {string} tenantId - Tenant identifier
   * @param {string} customDomain - Specific custom domain to use
   * @param {boolean} isRetry - Whether this is a retry attempt
   * @param {number} maxDepth - Maximum recursion depth (default: 3)
   * @returns {Object} - Distribution details
   */
  async _createTenantDistributionWithDomain(tenantId, customDomain, isRetry = false, maxDepth = 3) {
    if (maxDepth <= 0) {
      logger.warn('Maximum retry depth reached, falling back to emergency fallback', {
        tenantId,
        customDomain
      });
      throw new Error('Maximum retry depth reached');
    }

    try {
      logger.info('Creating CloudFront distribution with specific domain', { 
        tenantId, 
        customDomain,
        isRetry,
        remainingRetries: maxDepth
      });
      
      const uniqueId = TenantDistributionService.generateUniqueId(tenantId);
      const callerReference = `tenant-${tenantId}-retry-${Date.now()}`;
      
      // Create DNS record first for the custom domain
      let dnsChangeId = null;
      if (customDomain && this.dnsService.enabled) {
        try {
          const tempTarget = `temp-${uniqueId}.cloudfront.net`;
          dnsChangeId = await this.dnsService.createTenantDNSRecord(
            tenantId, // Use tenantId directly, not the complex replace logic
            tempTarget
          );
          
          if (dnsChangeId) {
            // Wait for DNS propagation
            await new Promise(resolve => setTimeout(resolve, 10000));
          }
        } catch (dnsError) {
          logger.warn('Failed to create DNS record for custom domain', {
            tenantId,
            customDomain,
            error: dnsError.message
          });
        }
      }

      // Create CloudFront distribution with custom domain
      const distributionConfig = {
        CallerReference: callerReference,
        Comment: `Tenant distribution: ${tenantId} (retry with ${customDomain})`,
        Enabled: true,
        PriceClass: 'PriceClass_100',
        
        // Custom domain aliases
        Aliases: customDomain ? {
          Quantity: 1,
          Items: [customDomain]
        } : {
          Quantity: 0,
          Items: []
        },
        
        // SSL certificate configuration
        ViewerCertificate: customDomain ? {
          ACMCertificateArn: process.env.SSL_CERTIFICATE_ARN,
          SSLSupportMethod: 'sni-only',
          MinimumProtocolVersion: 'TLSv1.2_2021',
          CertificateSource: 'acm'
        } : {
          CloudFrontDefaultCertificate: true
        },
        
        // Origins configuration
        Origins: {
          Quantity: 1,
          Items: [{
            Id: `${tenantId}-s3-origin`,
            DomainName: `${process.env.AWS_S3_BUCKET_STATIC}.s3.amazonaws.com`,
            OriginPath: `/tenants/${tenantId}`,
            S3OriginConfig: {
              OriginAccessIdentity: ''
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
            Quantity: 7,
            Items: ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
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
            Quantity: 0,
            Items: []
          }
        }
      };

      logger.info('Creating CloudFront distribution with retry configuration', {
        tenantId,
        customDomain,
        callerReference
      });

      const result = await cloudFront.createDistribution({
        DistributionConfig: distributionConfig
      }).promise();

      const distribution = result.Distribution;
      const distributionDomain = distribution.DomainName;
      const primaryDomain = customDomain || distributionDomain;

      // Update DNS record to point to actual distribution
      if (customDomain && dnsChangeId && this.dnsService.enabled) {
        try {
          await this.dnsService.updateTenantDNSRecord(
            tenantId, // Use tenantId directly, not the complex replace logic
            distributionDomain
          );
        } catch (updateError) {
          logger.warn('Failed to update DNS record after distribution creation', {
            tenantId,
            error: updateError.message
          });
        }
      }

      // Store distribution details
      await this.storeTenantDistribution(tenantId, {
        distributionId: distribution.Id,
        domain: primaryDomain,
        cloudfrontDomain: distributionDomain,
        customDomain: customDomain,
        status: distribution.Status,
        uniqueId: uniqueId,
        dnsChangeId: dnsChangeId,
        isRetry: true
      });

      logger.info('Retry CloudFront distribution created successfully', {
        tenantId,
        distributionId: distribution.Id,
        customDomain,
        primaryDomain
      });

      return {
        distributionId: distribution.Id,
        domain: primaryDomain,
        cloudfrontDomain: distributionDomain,
        customDomain: customDomain,
        status: distribution.Status,
        uniqueId: uniqueId,
        deploymentUrl: `https://${primaryDomain}`,
        isRetry: true
      };

    } catch (retryError) {
      logger.error('Retry distribution creation failed', {
        tenantId,
        customDomain,
        error: retryError.message
      });
      throw retryError;
    }
  }
}

module.exports = TenantDistributionService;