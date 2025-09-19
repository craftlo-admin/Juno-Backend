const AWS = require('aws-sdk');
const logger = require('../utils/logger');

/**
 * CloudFront Conflict Resolution Service
 * Handles CNAME conflicts and provides fallback strategies
 */
class CloudFrontConflictResolver {
  
  constructor() {
    this.cloudFront = new AWS.CloudFront({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1'
    });
  }

  /**
   * Check if a CNAME is already in use by another CloudFront distribution
   * @param {string} cname - The custom domain to check
   * @returns {Object} - Conflict information
   */
  async checkCNAMEConflict(cname) {
    try {
      logger.info('Checking CNAME conflict for domain', { cname });
      
      const distributionsResult = await this.cloudFront.listDistributions().promise();
      const distributions = distributionsResult.DistributionList.Items;
      
      for (const distribution of distributions) {
        if (distribution.Aliases && distribution.Aliases.Items) {
          for (const alias of distribution.Aliases.Items) {
            if (alias === cname) {
              logger.warn('CNAME conflict detected', {
                cname,
                conflictingDistributionId: distribution.Id,
                conflictingDomain: distribution.DomainName,
                status: distribution.Status
              });
              
              return {
                hasConflict: true,
                conflictingDistributionId: distribution.Id,
                conflictingDomain: distribution.DomainName,
                conflictingStatus: distribution.Status,
                conflictingEnabled: distribution.Enabled
              };
            }
          }
        }
      }
      
      logger.info('No CNAME conflict found', { cname });
      return { hasConflict: false };
      
    } catch (error) {
      logger.error('Error checking CNAME conflict', {
        cname,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Resolve CNAME conflict using various strategies
   * @param {string} tenantId - Tenant identifier
   * @param {string} originalCNAME - The conflicting CNAME
   * @param {Object} conflictInfo - Information about the conflict
   * @returns {Object} - Resolution strategy and new domain
   */
  async resolveCNAMEConflict(tenantId, originalCNAME, conflictInfo) {
    logger.info('Resolving CNAME conflict', {
      tenantId,
      originalCNAME,
      conflictInfo
    });

    // Check if we actually have a conflict to resolve
    if (!conflictInfo.hasConflict || !conflictInfo.conflictingDistributionId) {
      logger.warn('No conflict to resolve or missing distribution ID', { 
        tenantId, 
        originalCNAME,
        hasConflict: conflictInfo.hasConflict,
        conflictingDistributionId: conflictInfo.conflictingDistributionId
      });
      return {
        strategy: 'no_conflict',
        domain: originalCNAME,
        distributionId: null,
        message: 'No conflict found, proceeding with original domain'
      };
    }

    // Strategy 1: Check if conflicting distribution belongs to same tenant
    const strategy1 = await this.checkIfSameTenant(tenantId, conflictInfo.conflictingDistributionId);
    if (strategy1.canReuse) {
      return {
        strategy: 'reuse_existing',
        domain: originalCNAME,
        distributionId: conflictInfo.conflictingDistributionId,
        message: 'Reusing existing distribution for same tenant'
      };
    }

    // Strategy 2: Generate alternative CNAME with suffix
    const strategy2 = await this.generateAlternativeCNAME(tenantId, originalCNAME);
    if (strategy2.available) {
      return {
        strategy: 'alternative_cname',
        domain: strategy2.alternativeCNAME,
        distributionId: null,
        message: 'Using alternative CNAME to avoid conflict'
      };
    }

    // Strategy 3: Use CloudFront domain only (no custom CNAME)
    return {
      strategy: 'cloudfront_only',
      domain: null, // Will use CloudFront domain
      distributionId: null,
      message: 'Using CloudFront domain without custom CNAME'
    };
  }

  /**
   * Check if the conflicting distribution belongs to the same tenant
   * @param {string} tenantId - Current tenant ID
   * @param {string} distributionId - Conflicting distribution ID
   * @returns {Object} - Whether the distribution can be reused
   */
  async checkIfSameTenant(tenantId, distributionId) {
    try {
      // Safety check for null/undefined distribution ID
      if (!distributionId) {
        logger.warn('checkIfSameTenant called with null/undefined distributionId', { tenantId });
        return { canReuse: false };
      }

      // Get distribution details to check the comment/origin for tenant identification
      const distributionResult = await this.cloudFront.getDistribution({
        Id: distributionId
      }).promise();
      
      const distribution = distributionResult.Distribution;
      const comment = distribution.DistributionConfig.Comment;
      
      // Check if distribution comment contains the tenant ID
      if (comment && comment.includes(`tenant: ${tenantId}`)) {
        logger.info('Conflicting distribution belongs to same tenant', {
          tenantId,
          distributionId
        });
        return { canReuse: true };
      }
      
      // Check origin path for tenant identifier
      const origins = distribution.DistributionConfig.Origins.Items;
      for (const origin of origins) {
        if (origin.OriginPath && origin.OriginPath.includes(`/tenants/${tenantId}`)) {
          logger.info('Conflicting distribution has same tenant origin path', {
            tenantId,
            distributionId,
            originPath: origin.OriginPath
          });
          return { canReuse: true };
        }
      }
      
      return { canReuse: false };
      
    } catch (error) {
      logger.error('Error checking distribution ownership', {
        tenantId,
        distributionId,
        error: error.message
      });
      return { canReuse: false };
    }
  }

  /**
   * Generate alternative CNAME by adding suffixes
   * @param {string} tenantId - Tenant identifier
   * @param {string} originalCNAME - Original conflicting CNAME
   * @returns {Object} - Alternative CNAME information
   */
  async generateAlternativeCNAME(tenantId, originalCNAME) {
    const suffixes = ['v2', 'alt', 'new', 'app', 'site'];
    const baseDomain = process.env.CUSTOM_DOMAIN_BASE || 'junotech.in';
    
    for (const suffix of suffixes) {
      // Extract tenant part and add suffix
      const tenantPart = originalCNAME.replace(`.${baseDomain}`, '');
      const alternativeCNAME = `${tenantPart}-${suffix}.${baseDomain}`;
      
      const conflictCheck = await this.checkCNAMEConflict(alternativeCNAME);
      if (!conflictCheck.hasConflict) {
        logger.info('Found available alternative CNAME', {
          tenantId,
          originalCNAME,
          alternativeCNAME
        });
        return {
          available: true,
          alternativeCNAME: alternativeCNAME
        };
      }
    }
    
    // Try with random suffix if all standard suffixes are taken
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const tenantPart = originalCNAME.replace(`.${baseDomain}`, '');
    const randomCNAME = `${tenantPart}-${randomSuffix}.${baseDomain}`;
    
    const conflictCheck = await this.checkCNAMEConflict(randomCNAME);
    if (!conflictCheck.hasConflict) {
      logger.info('Generated random alternative CNAME', {
        tenantId,
        originalCNAME,
        randomCNAME
      });
      return {
        available: true,
        alternativeCNAME: randomCNAME
      };
    }
    
    logger.warn('Could not generate available alternative CNAME', {
      tenantId,
      originalCNAME
    });
    return { available: false };
  }

  /**
   * Clean up orphaned CNAME records that point to non-existent distributions
   * @param {string} cname - CNAME to check and potentially clean up
   * @returns {boolean} - Whether cleanup was performed
   */
  async cleanupOrphanedCNAME(cname) {
    try {
      logger.info('Checking for orphaned CNAME', { cname });
      
      const distributionsResult = await this.cloudFront.listDistributions().promise();
      const distributions = distributionsResult.DistributionList.Items;
      
      let foundActiveDistribution = false;
      
      for (const distribution of distributions) {
        if (distribution.Aliases && distribution.Aliases.Items) {
          if (distribution.Aliases.Items.includes(cname)) {
            if (distribution.Status === 'Deployed' && distribution.Enabled) {
              foundActiveDistribution = true;
              break;
            } else {
              logger.info('Found inactive distribution using CNAME', {
                cname,
                distributionId: distribution.Id,
                status: distribution.Status,
                enabled: distribution.Enabled
              });
            }
          }
        }
      }
      
      if (!foundActiveDistribution) {
        logger.info('CNAME appears to be orphaned or points to inactive distribution', { cname });
        // In a real scenario, you might want to clean up DNS records here
        return true;
      }
      
      return false;
      
    } catch (error) {
      logger.error('Error checking for orphaned CNAME', {
        cname,
        error: error.message
      });
      return false;
    }
  }
}

module.exports = CloudFrontConflictResolver;