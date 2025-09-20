const AWS = require('aws-sdk');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const cloudFront = new AWS.CloudFront();

/**
 * Shared Distribution Setup Service
 * Creates and configures the shared CloudFront distribution for multi-tenant use
 */
class SharedDistributionSetupService {
  
  constructor() {
    this.bucketName = process.env.AWS_S3_BUCKET_STATIC;
    this.customDomainBase = process.env.CUSTOM_DOMAIN_BASE || 'junotech.in';
    this.sslCertificateArn = process.env.WILDCARD_SSL_CERTIFICATE_ARN; // *.junotech.in
    this.hostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID;
  }

  /**
   * Create the shared CloudFront distribution for all tenants
   * This should be run once during initial setup
   * @returns {Object} - Distribution creation result
   */
  async createSharedDistribution() {
    try {
      logger.info('Creating shared CloudFront distribution for multi-tenant architecture');

      // Load and prepare the CloudFront Function code
      const functionCode = await this.loadTenantRoutingFunction();
      
      // Create the CloudFront Function first
      const functionResult = await this.createTenantRoutingFunction(functionCode);
      
      // Create the distribution configuration
      const distributionConfig = {
        CallerReference: `shared-tenant-distribution-${Date.now()}`,
        // Only include aliases if we have a valid SSL certificate
        Aliases: this.sslCertificateArn ? {
          Quantity: 1,
          Items: [`*.${this.customDomainBase}`] // Wildcard for all subdomains
        } : {
          Quantity: 0,
          Items: []
        },
        DefaultRootObject: 'index.html',
        Comment: 'Shared CloudFront distribution for multi-tenant website builder',
        Enabled: true,
        Origins: {
          Quantity: 1,
          Items: [{
            Id: 'S3-SharedTenantBucket',
            DomainName: `${this.bucketName}.s3.amazonaws.com`,
            OriginPath: '', // Root of bucket
            S3OriginConfig: {
              OriginAccessIdentity: '' // Will be configured after OAI creation
            }
          }]
        },
        DefaultCacheBehavior: {
          TargetOriginId: 'S3-SharedTenantBucket',
          ViewerProtocolPolicy: 'redirect-to-https',
          CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6', // AWS Managed caching optimized
          OriginRequestPolicyId: '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf', // AWS Managed CORS-S3Origin
          FunctionAssociations: {
            Quantity: 1,
            Items: [{
              EventType: 'viewer-request',
              FunctionARN: functionResult.FunctionSummary.FunctionMetadata.FunctionARN
            }]
          },
          Compress: true,
          AllowedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD'],
            CachedMethods: {
              Quantity: 2,
              Items: ['GET', 'HEAD']
            }
          },
          TrustedSigners: {
            Enabled: false,
            Quantity: 0
          }
        },
        // SSL Certificate configuration
        ViewerCertificate: this.sslCertificateArn ? {
          ACMCertificateArn: this.sslCertificateArn,
          SSLSupportMethod: 'sni-only',
          MinimumProtocolVersion: 'TLSv1.2_2021',
          CertificateSource: 'acm'
        } : {
          CloudFrontDefaultCertificate: true
        },
        CustomErrorResponses: {
          Quantity: 2,
          Items: [
            {
              ErrorCode: 404,
              ResponsePagePath: '/404.html',
              ResponseCode: '404',
              ErrorCachingMinTTL: 300
            },
            {
              ErrorCode: 403,
              ResponsePagePath: '/index.html', // SPA fallback
              ResponseCode: '200',
              ErrorCachingMinTTL: 0
            }
          ]
        },
        PriceClass: 'PriceClass_All', // Global distribution
        HttpVersion: 'http2',
        IsIPV6Enabled: true
      };

      // Create the distribution
      logger.info('Creating CloudFront distribution with configuration', {
        bucketName: this.bucketName,
        customDomainBase: this.customDomainBase,
        sslEnabled: !!this.sslCertificateArn,
        aliasesConfigured: !!this.sslCertificateArn,
        certificateArn: this.sslCertificateArn || 'Using CloudFront default certificate'
      });

      const result = await cloudFront.createDistribution({
        DistributionConfig: distributionConfig
      }).promise();

      const distribution = result.Distribution;

      logger.info('Shared CloudFront distribution created successfully', {
        distributionId: distribution.Id,
        domainName: distribution.DomainName,
        status: distribution.Status,
        functionARN: functionResult.FunctionSummary.FunctionMetadata.FunctionARN
      });

      return {
        distributionId: distribution.Id,
        domainName: distribution.DomainName,
        status: distribution.Status,
        aliases: distribution.DistributionConfig.Aliases.Items,
        functionARN: functionResult.FunctionSummary.FunctionMetadata.FunctionARN,
        environmentVariables: {
          SHARED_CLOUDFRONT_DISTRIBUTION_ID: distribution.Id,
          SHARED_CLOUDFRONT_DOMAIN: distribution.DomainName
        }
      };

    } catch (error) {
      logger.error('Failed to create shared CloudFront distribution', {
        error: error.message,
        code: error.code
      });
      throw error;
    }
  }

  /**
   * Load the tenant routing function code from file
   * @returns {string} - Function code
   */
  async loadTenantRoutingFunction() {
    try {
      const functionPath = path.join(__dirname, '../cloudfront/tenant-routing-function.js');
      const functionCode = await fs.readFile(functionPath, 'utf8');
      
      // Extract just the function content (remove comments and wrapper)
      const functionMatch = functionCode.match(/function handler\(event\)\s*{([\s\S]*?)}\s*$/m);
      if (!functionMatch) {
        throw new Error('Could not extract handler function from tenant-routing-function.js');
      }
      
      return `function handler(event) {${functionMatch[1]}}`;
    } catch (error) {
      logger.error('Failed to load tenant routing function', { error: error.message });
      throw error;
    }
  }

  /**
   * Create CloudFront Function for tenant routing
   * @param {string} functionCode - Function code
   * @returns {Object} - Function creation result
   */
  async createTenantRoutingFunction(functionCode) {
    try {
      const functionName = `tenant-routing-${Date.now()}`;
      
      const params = {
        Name: functionName,
        FunctionCode: Buffer.from(functionCode),
        FunctionConfig: {
          Comment: 'Routes tenant requests to correct S3 paths in shared distribution',
          Runtime: 'cloudfront-js-1.0'
        }
      };

      logger.info('Creating CloudFront Function for tenant routing', { functionName });

      const result = await cloudFront.createFunction(params).promise();

      // Publish the function (required before it can be used)
      await cloudFront.publishFunction({
        Name: functionName,
        IfMatch: result.ETag
      }).promise();

      logger.info('CloudFront Function created and published', {
        functionName: functionName,
        functionARN: result.FunctionSummary.FunctionMetadata.FunctionARN
      });

      return result;
    } catch (error) {
      logger.error('Failed to create CloudFront Function', { error: error.message });
      throw error;
    }
  }

  /**
   * Get shared distribution status
   * @returns {Object} - Status information
   */
  async getSharedDistributionStatus() {
    try {
      const distributionId = process.env.SHARED_CLOUDFRONT_DISTRIBUTION_ID;
      if (!distributionId) {
        return {
          exists: false,
          message: 'SHARED_CLOUDFRONT_DISTRIBUTION_ID not configured'
        };
      }

      const result = await cloudFront.getDistribution({ Id: distributionId }).promise();
      const distribution = result.Distribution;

      return {
        exists: true,
        distributionId: distribution.Id,
        domainName: distribution.DomainName,
        status: distribution.Status,
        enabled: distribution.DistributionConfig.Enabled,
        aliases: distribution.DistributionConfig.Aliases.Items,
        lastModified: distribution.LastModifiedTime
      };
    } catch (error) {
      return {
        exists: false,
        error: error.message
      };
    }
  }

  /**
   * Generate setup instructions and environment variables
   * @param {Object} distributionResult - Result from createSharedDistribution
   * @returns {Object} - Setup instructions
   */
  generateSetupInstructions(distributionResult) {
    const hasSSL = !!this.sslCertificateArn;
    const hasAliases = distributionResult.aliases && distributionResult.aliases.length > 0;
    
    const nextSteps = [
      'Add the following environment variables to your .env file:',
      `SHARED_CLOUDFRONT_DISTRIBUTION_ID=${distributionResult.distributionId}`,
      `SHARED_CLOUDFRONT_DOMAIN=${distributionResult.domainName}`,
      ''
    ];

    if (hasSSL && hasAliases) {
      nextSteps.push(
        'DNS Configuration:',
        `✅ Create CNAME record: *.${this.customDomainBase} -> ${distributionResult.domainName}`,
        ''
      );
    } else {
      nextSteps.push(
        'DNS Configuration (MANUAL SETUP REQUIRED):',
        `⚠️  No custom domains configured (missing SSL certificate)`,
        `   To enable custom domains (tenant.${this.customDomainBase}):`,
        `   1. Create wildcard SSL certificate in ACM (us-east-1): *.${this.customDomainBase}`,
        `   2. Update distribution to include certificate ARN`,
        `   3. Add CNAME record: *.${this.customDomainBase} -> ${distributionResult.domainName}`,
        ''
      );
    }

    nextSteps.push(
      'Current Access Method:',
      hasAliases 
        ? `✅ Custom domains: https://tenant1.${this.customDomainBase}`
        : `⚠️  Direct CloudFront only: https://${distributionResult.domainName}/tenant-tenant1/`,
      ''
    );

    nextSteps.push(
      'SSL Certificate:',
      hasSSL 
        ? `✅ Using wildcard SSL certificate: ${this.sslCertificateArn}`
        : `⚠️  Using CloudFront default certificate (*.cloudfront.net only)`,
      '',
      'Testing:',
      `Distribution available at: https://${distributionResult.domainName}`,
      hasAliases 
        ? `Tenant URLs: https://tenant1.${this.customDomainBase}`
        : `Direct access: https://${distributionResult.domainName}/tenant-tenant1/`,
      '',
      '⏳ Distribution deployment takes 15-20 minutes to complete'
    );

    return {
      success: true,
      message: 'Shared CloudFront distribution created successfully',
      nextSteps,
      distributionInfo: distributionResult,
      sslConfigured: hasSSL,
      customDomainsEnabled: hasAliases
    };
  }
}

module.exports = SharedDistributionSetupService;