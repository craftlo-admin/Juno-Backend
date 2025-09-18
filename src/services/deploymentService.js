const { cloudFront } = require('../config/aws');
const { uploadToS3, copyS3Object } = require('./storageService');
const logger = require('../utils/logger');

/**
 * Deploy tenant site to CloudFront
 * @param {string} tenantId - Tenant identifier
 * @param {string} version - Version to deploy
 * @param {string} buildPath - S3 path to build artifacts
 */
async function deployToCloudFront(tenantId, version, buildPath) {
  try {
    logger.info(`Deploying ${tenantId} version ${version} to CloudFront`);

    // Update pointer file to new version
    await updateVersionPointer(tenantId, version);

    // Invalidate CloudFront cache for tenant
    await invalidateCloudFrontCache(tenantId);

    logger.info(`CloudFront deployment completed for ${tenantId}`);
    
  } catch (error) {
    logger.error(`CloudFront deployment failed for ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Rollback deployment to previous version
 * @param {string} tenantId - Tenant identifier
 * @param {string} targetVersion - Version to rollback to
 * @param {string} buildPath - S3 path to target build artifacts
 */
async function rollbackDeployment(tenantId, targetVersion, buildPath) {
  try {
    logger.info(`Rolling back ${tenantId} to version ${targetVersion}`);

    // Update pointer to target version
    await updateVersionPointer(tenantId, targetVersion);

    // Invalidate CloudFront cache
    await invalidateCloudFrontCache(tenantId);

    logger.info(`Rollback completed for ${tenantId} to version ${targetVersion}`);
    
  } catch (error) {
    logger.error(`Rollback failed for ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Update version pointer for tenant
 * @param {string} tenantId - Tenant identifier
 * @param {string} version - Version to point to
 */
async function updateVersionPointer(tenantId, version) {
  try {
    const pointerContent = {
      tenantId: tenantId,
      version: version,
      timestamp: new Date().toISOString(),
      path: `tenants/${tenantId}/${version}/`
    };

    const pointerKey = `pointers/${tenantId}/current.json`;
    
    await uploadToS3({
      key: pointerKey,
      body: JSON.stringify(pointerContent, null, 2),
      contentType: 'application/json',
      bucket: process.env.AWS_S3_BUCKET_STATIC,
      metadata: {
        tenantId: tenantId,
        version: version
      }
    });

    logger.info(`Version pointer updated for ${tenantId} -> ${version}`);
    
  } catch (error) {
    logger.error(`Failed to update version pointer for ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Invalidate CloudFront cache for tenant
 * @param {string} tenantId - Tenant identifier
 * @returns {string} - Invalidation ID
 */
async function invalidateCloudFrontCache(tenantId) {
  try {
    const distributionId = process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID;
    
    if (!distributionId) {
      logger.warn('CloudFront distribution ID not configured, skipping invalidation');
      return null;
    }

    const invalidationPaths = [
      `/pointers/${tenantId}/*`,
      `/tenants/${tenantId}/current/*`,
      `/${tenantId}/*` // If using path-based routing
    ];

    const params = {
      DistributionId: distributionId,
      InvalidationBatch: {
        Paths: {
          Quantity: invalidationPaths.length,
          Items: invalidationPaths
        },
        CallerReference: `${tenantId}-${Date.now()}`
      }
    };

    const result = await cloudFront.createInvalidation(params).promise();
    
    logger.info(`CloudFront invalidation created for ${tenantId}: ${result.Invalidation.Id}`);
    
    return result.Invalidation.Id;
    
  } catch (error) {
    logger.error(`CloudFront invalidation failed for ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Get CloudFront invalidation status
 * @param {string} invalidationId - Invalidation ID
 * @returns {Object} - Invalidation status
 */
async function getInvalidationStatus(invalidationId) {
  try {
    const distributionId = process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID;
    
    const params = {
      DistributionId: distributionId,
      Id: invalidationId
    };

    const result = await cloudFront.getInvalidation(params).promise();
    
    return {
      id: result.Invalidation.Id,
      status: result.Invalidation.Status,
      createTime: result.Invalidation.CreateTime,
      paths: result.Invalidation.InvalidationBatch.Paths.Items
    };
    
  } catch (error) {
    logger.error(`Failed to get invalidation status for ${invalidationId}:`, error);
    throw error;
  }
}

/**
 * Create or update CloudFront distribution for tenant (if using per-tenant distributions)
 * This is an alternative approach to using a single distribution with edge rewrites
 * @param {string} tenantId - Tenant identifier
 * @param {string} customDomain - Optional custom domain
 */
async function createTenantDistribution(tenantId, customDomain = null) {
  try {
    // This is a complex operation that would involve:
    // 1. Creating a CloudFront distribution
    // 2. Configuring origins to point to S3
    // 3. Setting up SSL certificates
    // 4. Configuring caching behaviors
    // 
    // For this implementation, we're using a single distribution approach
    // with edge functions for routing, which is more cost-effective
    
    logger.info(`Tenant distribution management not implemented for per-tenant distributions`);
    throw new Error('Per-tenant CloudFront distributions not implemented');
    
  } catch (error) {
    logger.error(`Failed to create tenant distribution for ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Generate CloudFront Lambda@Edge function for tenant routing
 * This function would be deployed to handle request routing
 */
function generateEdgeFunction() {
  return `
'use strict';

const AWS = require('aws-sdk');
const s3 = new AWS.S3({region: 'us-east-1'});

exports.handler = async (event, context) => {
    const request = event.Records[0].cf.request;
    const headers = request.headers;
    
    // Extract tenant ID from Host header
    const host = headers.host[0].value;
    const tenantId = extractTenantId(host);
    
    if (!tenantId) {
        return {
            status: '404',
            statusDescription: 'Not Found',
            body: 'Tenant not found'
        };
    }
    
    try {
        // Get current version for tenant
        const version = await getCurrentVersion(tenantId);
        
        // Rewrite request URI
        request.uri = \`/tenants/\${tenantId}/\${version}\${request.uri}\`;
        
        // Add tenant header for origin
        request.headers['x-tenant-id'] = [{key: 'X-Tenant-Id', value: tenantId}];
        
        return request;
        
    } catch (error) {
        console.error('Edge function error:', error);
        return {
            status: '500',
            statusDescription: 'Internal Server Error',
            body: 'Service temporarily unavailable'
        };
    }
};

function extractTenantId(host) {
    const baseDomain = '${process.env.BASE_DOMAIN}';
    if (host.endsWith(\`.\${baseDomain}\`)) {
        return host.replace(\`.\${baseDomain}\`, '');
    }
    return null;
}

async function getCurrentVersion(tenantId) {
    try {
        const params = {
            Bucket: '${process.env.AWS_S3_BUCKET_STATIC}',
            Key: \`pointers/\${tenantId}/current.json\`
        };
        
        const result = await s3.getObject(params).promise();
        const pointer = JSON.parse(result.Body.toString());
        
        return pointer.version;
    } catch (error) {
        // Default to 'current' if pointer not found
        return 'current';
    }
}
  `.trim();
}

module.exports = {
  deployToCloudFront,
  rollbackDeployment,
  updateVersionPointer,
  invalidateCloudFrontCache,
  getInvalidationStatus,
  createTenantDistribution,
  generateEdgeFunction
};
