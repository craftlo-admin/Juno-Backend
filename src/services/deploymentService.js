const { cloudFront } = require('../config/aws');
const { uploadToS3, copyS3Object, listS3Objects } = require('./storageService');
const TenantDistributionService = require('./tenantDistributionService');
const SharedTenantDistributionService = require('./sharedTenantDistributionService');
const DeploymentStrategySelector = require('./deploymentStrategySelector');
const logger = require('../utils/logger');

// Initialize services
const sharedDistributionService = new SharedTenantDistributionService();
const strategySelector = new DeploymentStrategySelector();

/**
 * Deploy tenant site to CloudFront using appropriate distribution strategy
 * @param {string} tenantId - Tenant identifier
 * @param {string} version - Version to deploy
 * @param {string} buildPath - S3 path to build artifacts
 * @param {Object} tenant - Tenant object with subscription and configuration
 */
async function deployToCloudFront(tenantId, version, buildPath, tenant = null) {
  try {
    logger.info(`Deploying ${tenantId} version ${version} to CloudFront`);

    // Determine deployment strategy for this tenant
    const strategy = await getDeploymentStrategy(tenantId, tenant);
    
    logger.info('Using deployment strategy for tenant', {
      tenantId,
      strategy: strategy.strategy,
      reasons: strategy.reason
    });

    let deploymentResult;

    if (strategy.strategy === 'individual') {
      // Deploy using individual CloudFront distribution
      deploymentResult = await deployToIndividualDistribution(tenantId, version, buildPath);
    } else {
      // Deploy using shared CloudFront distribution
      deploymentResult = await deployToSharedDistribution(tenantId, version, buildPath);
    }

    // Update version pointer (common for both strategies)
    await updateVersionPointer(tenantId, version);

    logger.info(`CloudFront deployment completed for ${tenantId}`, {
      strategy: strategy.strategy,
      ...deploymentResult
    });
    
    return {
      strategy: strategy.strategy,
      ...deploymentResult
    };
    
  } catch (error) {
    logger.error(`CloudFront deployment failed for ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Deploy to individual CloudFront distribution (enterprise tier)
 * @param {string} tenantId - Tenant identifier
 * @param {string} version - Version to deploy
 * @param {string} buildPath - S3 path to build artifacts
 */
async function deployToIndividualDistribution(tenantId, version, buildPath) {
  try {
    logger.info(`Deploying ${tenantId} to individual CloudFront distribution`);

    // Get or create individual CloudFront distribution for this tenant
    const distribution = await TenantDistributionService.getOrCreateTenantDistribution(tenantId);
    
    logger.info('Using individual CloudFront distribution for tenant', {
      tenantId,
      distributionId: distribution.distributionId,
      domain: distribution.domain
    });

    // Invalidate tenant's individual CloudFront cache
    await TenantDistributionService.invalidateTenantCache(tenantId);

    return {
      type: 'individual',
      distributionId: distribution.distributionId,
      domain: distribution.domain,
      deploymentUrl: distribution.deploymentUrl
    };
    
  } catch (error) {
    logger.error(`Individual distribution deployment failed for ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Deploy to shared CloudFront distribution (standard tier)
 * @param {string} tenantId - Tenant identifier
 * @param {string} version - Version to deploy
 * @param {string} buildPath - S3 path to build artifacts
 */
async function deployToSharedDistribution(tenantId, version, buildPath) {
  try {
    logger.info(`Deploying ${tenantId} to shared CloudFront distribution`);

    // Setup tenant domain on shared distribution
    const tenantDomain = await sharedDistributionService.getOrSetupTenantDomain(tenantId);
    
    logger.info('Using shared CloudFront distribution for tenant', {
      tenantId,
      distributionId: tenantDomain.distributionId,
      tenantDomain: tenantDomain.tenantDomain,
      cloudFrontDomain: tenantDomain.cloudFrontDomain
    });

    // Invalidate tenant's cache on shared distribution
    await sharedDistributionService.invalidateTenantCache(tenantId);

    return {
      type: 'shared',
      distributionId: tenantDomain.distributionId,
      domain: tenantDomain.cloudFrontDomain,
      tenantDomain: tenantDomain.tenantDomain,
      deploymentUrl: `https://${tenantDomain.tenantDomain}`
    };
    
  } catch (error) {
    logger.error(`Shared distribution deployment failed for ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Rollback deployment to previous version using appropriate distribution strategy
 * @param {string} tenantId - Tenant identifier
 * @param {string} targetVersion - Version to rollback to
 * @param {string} buildPath - S3 path to target build artifacts
 * @param {Object} tenant - Tenant object with subscription and configuration
 */
async function rollbackDeployment(tenantId, targetVersion, buildPath, tenant = null) {
  try {
    logger.info(`Rolling back ${tenantId} to version ${targetVersion}`);

    // Determine deployment strategy for this tenant
    const strategy = await getDeploymentStrategy(tenantId, tenant);
    
    // Update pointer to target version (common for both strategies)
    await updateVersionPointer(tenantId, targetVersion);

    // Invalidate cache using appropriate strategy
    if (strategy.strategy === 'individual') {
      await TenantDistributionService.invalidateTenantCache(tenantId);
    } else {
      await sharedDistributionService.invalidateTenantCache(tenantId);
    }

    logger.info(`Rollback completed for ${tenantId} to version ${targetVersion}`, {
      strategy: strategy.strategy
    });
    
  } catch (error) {
    logger.error(`Rollback failed for ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Update version pointer and create physical /current/ directory for CloudFront Functions
 * @param {string} tenantId - Tenant identifier
 * @param {string} version - Version to point to
 */
async function updateVersionPointer(tenantId, version) {
  try {
    const pointerContent = {
      tenantId: tenantId,
      version: version,
      timestamp: new Date().toISOString(),
      path: `tenants/${tenantId}/deployments/${version}/`
    };

    // Create version pointer file (for API/backend reference)
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

    // Create physical /current/ directory by copying all files from versioned directory
    // This is required for CloudFront Functions which cannot read pointer files
    await createPhysicalCurrentDirectory(tenantId, version);

    logger.info(`Version pointer and /current/ directory updated for ${tenantId} -> ${version}`);
    
  } catch (error) {
    logger.error(`Failed to update version pointer for ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Create physical /current/ directory by copying files from versioned directory
 * @param {string} tenantId - Tenant identifier
 * @param {string} version - Version to copy from
 */
async function createPhysicalCurrentDirectory(tenantId, version) {
  try {
    const bucket = process.env.AWS_S3_BUCKET_STATIC;
    const sourcePrefix = `tenants/${tenantId}/deployments/${version}/`;
    const targetPrefix = `tenants/${tenantId}/deployments/current/`;

    // List all objects in the versioned directory
    const objects = await listS3Objects({
      bucket: bucket,
      prefix: sourcePrefix
    });

    if (!objects || objects.length === 0) {
      logger.warn(`No objects found in ${sourcePrefix} for tenant ${tenantId}`);
      return;
    }

    logger.info(`📤 Copying ${objects.length} files to /current/ directory for ${tenantId}...`);
    
    // Batch copy operations for better performance and less verbose logging
    const copyPromises = objects.map(async (obj, index) => {
      const sourceKey = obj.Key;
      const relativePath = sourceKey.replace(sourcePrefix, '');
      const targetKey = `${targetPrefix}${relativePath}`;

      try {
        await copyS3Object({
          sourceBucket: bucket,
          sourceKey: sourceKey,
          destBucket: bucket,
          destKey: targetKey,
          suppressLogging: true // Suppress individual file logs
        });
        
        // Show progress for large deployments (every 10 files)
        if ((index + 1) % 10 === 0 || index === objects.length - 1) {
          logger.info(`📁 Progress: ${index + 1}/${objects.length} files copied to /current/`);
        }
        
        return { success: true, sourceKey, targetKey };
      } catch (error) {
        logger.error(`❌ Failed to copy ${sourceKey}: ${error.message}`);
        return { success: false, sourceKey, error: error.message };
      }
    });

    // Execute all copy operations in parallel (with concurrency limit)
    const BATCH_SIZE = 10; // Limit concurrent operations to avoid API throttling
    const results = [];
    
    for (let i = 0; i < copyPromises.length; i += BATCH_SIZE) {
      const batch = copyPromises.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
    }
    
    // Summary logging
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    if (failed > 0) {
      logger.warn(`⚠️  /current/ directory created with issues: ${successful} successful, ${failed} failed`);
      const failedFiles = results.filter(r => !r.success);
      failedFiles.forEach(f => logger.error(`   Failed: ${f.sourceKey} - ${f.error}`));
    } else {
      logger.info(`✅ Created physical /current/ directory for ${tenantId} with ${successful} files`);
    }
    
  } catch (error) {
    logger.error(`Failed to create physical /current/ directory for ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Invalidate CloudFront cache using appropriate distribution strategy
 * @param {string} tenantId - Tenant identifier
 * @param {string} buildId - Optional specific build to invalidate
 * @param {Object} tenant - Tenant object with subscription and configuration
 * @returns {string|null} - Invalidation ID or null
 */
async function invalidateCloudFrontCache(tenantId, buildId = null, tenant = null) {
  try {
    logger.info('Attempting CloudFront invalidation', {
      tenantId,
      buildId
    });

    // Determine deployment strategy for this tenant
    const strategy = await getDeploymentStrategy(tenantId, tenant);

    let invalidationId;

    if (strategy.strategy === 'individual') {
      // Use individual distribution service for cache invalidation
      invalidationId = await TenantDistributionService.invalidateTenantCache(tenantId, buildId);
      logger.info(`Individual distribution invalidation for tenant ${tenantId}`, {
        invalidationId,
        buildId
      });
    } else {
      // Use shared distribution service for cache invalidation
      invalidationId = await sharedDistributionService.invalidateTenantCache(tenantId, buildId);
      logger.info(`Shared distribution invalidation for tenant ${tenantId}`, {
        invalidationId,
        buildId
      });
    }
    
    if (invalidationId) {
      logger.info(`CloudFront invalidation created for tenant ${tenantId}: ${invalidationId}`, {
        strategy: strategy.strategy
      });
    } else {
      logger.warn(`CloudFront invalidation skipped for tenant ${tenantId}`, {
        strategy: strategy.strategy,
        reason: 'No distribution found or invalidation not needed'
      });
    }
    
    return invalidationId;
    
  } catch (error) {
    logger.error(`CloudFront invalidation failed for ${tenantId}:`, {
      error: error.message,
      code: error.code,
      buildId
    });
    
    // Return null instead of throwing to prevent build failures
    // CloudFront invalidation is an optimization, not a requirement
    return null;
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

/**
 * Get deployment strategy for tenant
 * @param {string} tenantId - Tenant identifier  
 * @param {Object} tenant - Tenant object (optional, will be fetched if not provided)
 * @returns {Object} - Strategy decision
 */
async function getDeploymentStrategy(tenantId, tenant = null) {
  try {
    // If tenant object not provided, create a minimal one
    // In production, this would fetch from database
    if (!tenant) {
      tenant = {
        id: tenantId,
        subscription_tier: 'standard', // Default tier
        deployment_strategy: null // No explicit preference
      };
    }

    // Get current distribution count for quota management
    // This would typically come from a cache or database query
    const currentDistributionCount = await getCurrentDistributionCount();

    const strategy = await strategySelector.determineStrategy(tenant, {
      currentDistributionCount
    });

    return strategy;
    
  } catch (error) {
    logger.error(`Failed to determine deployment strategy for ${tenantId}:`, error);
    
    // Fallback to shared distribution on error
    return {
      strategy: 'shared',
      reason: ['Fallback due to strategy selection error'],
      canUpgrade: false,
      canDowngrade: false
    };
  }
}

/**
 * Get current count of individual distributions
 * @returns {number} - Current distribution count
 */
async function getCurrentDistributionCount() {
  try {
    // This would typically query a database or cache
    // For now, return a conservative estimate
    return parseInt(process.env.CURRENT_DISTRIBUTION_COUNT) || 0;
  } catch (error) {
    logger.error('Failed to get current distribution count:', error);
    return 0;
  }
}

/**
 * Get deployment status for tenant
 * @param {string} tenantId - Tenant identifier
 * @param {Object} tenant - Tenant object (optional)
 * @returns {Object} - Deployment status
 */
async function getDeploymentStatus(tenantId, tenant = null) {
  try {
    const strategy = await getDeploymentStrategy(tenantId, tenant);
    
    let distributionInfo;
    
    if (strategy.strategy === 'individual') {
      // Get individual distribution info
      const distribution = await TenantDistributionService.getTenantDistribution(tenantId);
      distributionInfo = {
        type: 'individual',
        distributionId: distribution?.distributionId,
        domain: distribution?.domain,
        status: distribution?.status || 'not-deployed'
      };
    } else {
      // Get shared distribution info
      const tenantDomain = await sharedDistributionService.getTenantDomain(tenantId);
      distributionInfo = {
        type: 'shared',
        distributionId: tenantDomain?.distributionId,
        tenantDomain: tenantDomain?.tenantDomain,
        cloudFrontDomain: tenantDomain?.cloudFrontDomain,
        status: tenantDomain ? 'deployed' : 'not-deployed'
      };
    }
    
    return {
      tenantId,
      strategy: strategy.strategy,
      canUpgrade: strategy.canUpgrade,
      canDowngrade: strategy.canDowngrade,
      ...distributionInfo
    };
    
  } catch (error) {
    logger.error(`Failed to get deployment status for ${tenantId}:`, error);
    return {
      tenantId,
      strategy: 'unknown',
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Migrate tenant between deployment strategies
 * @param {string} tenantId - Tenant identifier
 * @param {string} targetStrategy - Target strategy ('individual' or 'shared')
 * @param {Object} tenant - Tenant object
 * @returns {Object} - Migration result
 */
async function migrateTenantStrategy(tenantId, targetStrategy, tenant) {
  try {
    logger.info(`Migrating tenant ${tenantId} to ${targetStrategy} strategy`);
    
    const currentStrategy = await getDeploymentStrategy(tenantId, tenant);
    
    if (currentStrategy.strategy === targetStrategy) {
      logger.info(`Tenant ${tenantId} already using ${targetStrategy} strategy`);
      return { success: true, message: 'Already using target strategy' };
    }
    
    // Validate target strategy is feasible
    const validation = await strategySelector.validateStrategy(tenant, targetStrategy, {
      currentDistributionCount: await getCurrentDistributionCount()
    });
    
    if (!validation.valid) {
      throw new Error(`Cannot migrate to ${targetStrategy}: ${validation.reason}`);
    }
    
    // Perform migration
    if (targetStrategy === 'individual') {
      // Migrate from shared to individual
      await migrateToIndividual(tenantId, tenant);
    } else {
      // Migrate from individual to shared
      await migrateToShared(tenantId, tenant);
    }
    
    logger.info(`Successfully migrated tenant ${tenantId} to ${targetStrategy} strategy`);
    
    return { 
      success: true, 
      message: `Migrated from ${currentStrategy.strategy} to ${targetStrategy}` 
    };
    
  } catch (error) {
    logger.error(`Failed to migrate tenant ${tenantId} to ${targetStrategy}:`, error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Migrate tenant from shared to individual distribution
 * @param {string} tenantId - Tenant identifier
 * @param {Object} tenant - Tenant object
 */
async function migrateToIndividual(tenantId, tenant) {
  // 1. Create individual distribution
  const distribution = await TenantDistributionService.getOrCreateTenantDistribution(tenantId);
  
  // 2. Update DNS to point to individual distribution
  // (This would be handled by TenantDistributionService)
  
  // 3. Invalidate both caches to ensure consistency
  await TenantDistributionService.invalidateTenantCache(tenantId);
  await sharedDistributionService.invalidateTenantCache(tenantId);
  
  logger.info(`Migrated tenant ${tenantId} to individual distribution`, {
    distributionId: distribution.distributionId
  });
}

/**
 * Migrate tenant from individual to shared distribution
 * @param {string} tenantId - Tenant identifier
 * @param {Object} tenant - Tenant object
 */
async function migrateToShared(tenantId, tenant) {
  // 1. Setup tenant on shared distribution
  const tenantDomain = await sharedDistributionService.getOrSetupTenantDomain(tenantId);
  
  // 2. Invalidate both caches to ensure consistency
  await sharedDistributionService.invalidateTenantCache(tenantId);
  await TenantDistributionService.invalidateTenantCache(tenantId);
  
  // 3. Individual distribution can be deleted later (not immediately for safety)
  logger.info(`Migrated tenant ${tenantId} to shared distribution`, {
    tenantDomain: tenantDomain.tenantDomain
  });
}

module.exports = {
  deployToCloudFront,
  deployToIndividualDistribution,
  deployToSharedDistribution,
  rollbackDeployment,
  updateVersionPointer,
  invalidateCloudFrontCache,
  getInvalidationStatus,
  createTenantDistribution,
  generateEdgeFunction,
  getDeploymentStrategy,
  getDeploymentStatus,
  migrateTenantStrategy,
  getCurrentDistributionCount
};
