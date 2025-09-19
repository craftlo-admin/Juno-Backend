const AWS = require('aws-sdk');
const logger = require('../utils/logger');

// Configure AWS Route 53
const route53 = new AWS.Route53({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

/**
 * DNS Service for Automated Route 53 Management
 * Handles automatic DNS record creation/deletion for tenant subdomains
 */
class DNSService {
  constructor() {
    this.hostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID;
    this.domain = process.env.CUSTOM_DOMAIN_BASE || 'junotech.in';
    this.enabled = process.env.ROUTE53_ENABLED === 'true';
  }

  /**
   * Create DNS record for new tenant
   * @param {string} tenantId - Tenant identifier
   * @param {string} cloudfrontDomain - CloudFront distribution domain
   * @returns {string} - Change ID for tracking
   */
  async createTenantDNSRecord(tenantId, cloudfrontDomain) {
    if (!this.enabled) {
      logger.info('Route 53 DNS automation disabled', { tenantId });
      return null;
    }

    if (!this.hostedZoneId) {
      throw new Error('ROUTE53_HOSTED_ZONE_ID environment variable not set');
    }

    const subdomain = `${tenantId}.${this.domain}`;
    
    // First check if DNS record already exists and what it points to
    const existingRecord = await this.getTenantDNSRecord(tenantId);
    
    if (existingRecord) {
      logger.info('DNS record already exists, updating target', {
        tenantId,
        subdomain,
        currentTarget: existingRecord.target,
        newTarget: cloudfrontDomain
      });
      
      // Update existing record instead of creating new one
      return await this.updateTenantDNSRecord(tenantId, cloudfrontDomain);
    }
    
    const params = {
      HostedZoneId: this.hostedZoneId,
      ChangeBatch: {
        Comment: `Auto-created DNS record for tenant: ${tenantId}`,
        Changes: [{
          Action: 'UPSERT', // Use UPSERT instead of CREATE to handle conflicts
          ResourceRecordSet: {
            Name: subdomain,
            Type: 'CNAME',
            TTL: 300,
            ResourceRecords: [{
              Value: cloudfrontDomain
            }]
          }
        }]
      }
    };

    try {
      logger.info('Creating DNS record for tenant', {
        tenantId,
        subdomain,
        cloudfrontDomain,
        hostedZoneId: this.hostedZoneId
      });

      const result = await route53.changeResourceRecordSets(params).promise();
      
      logger.info('DNS record created successfully', {
        tenantId,
        subdomain,
        changeId: result.ChangeInfo.Id,
        status: result.ChangeInfo.Status
      });

      return result.ChangeInfo.Id;
    } catch (error) {
      logger.error('Failed to create DNS record', {
        tenantId,
        subdomain,
        error: error.message,
        code: error.code
      });
      
      // Don't throw error - tenant creation should succeed even if DNS fails
      return null;
    }
  }

  /**
   * Delete DNS record for tenant (cleanup)
   * @param {string} tenantId - Tenant identifier
   * @param {string} cloudfrontDomain - CloudFront distribution domain
   * @returns {string} - Change ID for tracking
   */
  async deleteTenantDNSRecord(tenantId, cloudfrontDomain) {
    if (!this.enabled) {
      logger.info('Route 53 DNS automation disabled', { tenantId });
      return null;
    }

    const subdomain = `${tenantId}.${this.domain}`;
    
    const params = {
      HostedZoneId: this.hostedZoneId,
      ChangeBatch: {
        Comment: `Auto-deleted DNS record for tenant: ${tenantId}`,
        Changes: [{
          Action: 'DELETE',
          ResourceRecordSet: {
            Name: subdomain,
            Type: 'CNAME',
            TTL: 300,
            ResourceRecords: [{
              Value: cloudfrontDomain
            }]
          }
        }]
      }
    };

    try {
      logger.info('Deleting DNS record for tenant', {
        tenantId,
        subdomain,
        cloudfrontDomain
      });

      const result = await route53.changeResourceRecordSets(params).promise();
      
      logger.info('DNS record deleted successfully', {
        tenantId,
        subdomain,
        changeId: result.ChangeInfo.Id
      });

      return result.ChangeInfo.Id;
    } catch (error) {
      logger.error('Failed to delete DNS record', {
        tenantId,
        subdomain,
        error: error.message,
        code: error.code
      });
      
      return null;
    }
  }

  /**
   * Update DNS record for tenant (change CloudFront target)
   * @param {string} tenantId - Tenant identifier
   * @param {string} newCloudfrontDomain - New CloudFront distribution domain
   * @returns {string} - Change ID for tracking
   */
  async updateTenantDNSRecord(tenantId, newCloudfrontDomain) {
    if (!this.enabled) {
      logger.info('Route 53 DNS automation disabled', { tenantId });
      return null;
    }

    if (!this.hostedZoneId) {
      throw new Error('ROUTE53_HOSTED_ZONE_ID environment variable not set');
    }

    const subdomain = `${tenantId}.${this.domain}`;
    
    const params = {
      HostedZoneId: this.hostedZoneId,
      ChangeBatch: {
        Comment: `Auto-updated DNS record for tenant: ${tenantId}`,
        Changes: [{
          Action: 'UPSERT', // UPSERT creates or updates the record
          ResourceRecordSet: {
            Name: subdomain,
            Type: 'CNAME',
            TTL: 300,
            ResourceRecords: [{
              Value: newCloudfrontDomain
            }]
          }
        }]
      }
    };

    try {
      logger.info('Updating DNS record for tenant', {
        tenantId,
        subdomain,
        newTarget: newCloudfrontDomain,
        hostedZoneId: this.hostedZoneId
      });

      const result = await route53.changeResourceRecordSets(params).promise();
      
      logger.info('DNS record updated successfully', {
        tenantId,
        subdomain,
        changeId: result.ChangeInfo.Id,
        status: result.ChangeInfo.Status
      });

      return result.ChangeInfo.Id;
    } catch (error) {
      logger.error('Failed to update DNS record', {
        tenantId,
        subdomain,
        error: error.message,
        code: error.code
      });
      
      // Don't throw error - distribution should work even if DNS update fails
      return null;
    }
  }

  /**
   * Get existing DNS record for tenant
   * @param {string} tenantId - Tenant identifier
   * @returns {Object|null} - DNS record info or null if not found
   */
  async getTenantDNSRecord(tenantId) {
    if (!this.enabled) {
      return null;
    }

    const subdomain = `${tenantId}.${this.domain}`;
    
    try {
      const params = {
        HostedZoneId: this.hostedZoneId
      };

      const result = await route53.listResourceRecordSets(params).promise();
      
      const record = result.ResourceRecordSets.find(
        record => record.Name === `${subdomain}.` && record.Type === 'CNAME'
      );

      if (record && record.ResourceRecords && record.ResourceRecords.length > 0) {
        return {
          name: record.Name,
          type: record.Type,
          ttl: record.TTL,
          target: record.ResourceRecords[0].Value
        };
      }

      return null;
    } catch (error) {
      logger.error('Failed to get DNS record', {
        tenantId,
        subdomain,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Check if DNS record exists for tenant
   * @param {string} tenantId - Tenant identifier
   * @returns {boolean} - True if DNS record exists
   */
  async checkTenantDNSRecord(tenantId) {
    if (!this.enabled) {
      return false;
    }

    const subdomain = `${tenantId}.${this.domain}`;
    
    try {
      const params = {
        HostedZoneId: this.hostedZoneId,
        StartRecordName: subdomain,
        StartRecordType: 'CNAME'
      };

      const result = await route53.listResourceRecordSets(params).promise();
      
      const record = result.ResourceRecordSets.find(
        record => record.Name === `${subdomain}.` && record.Type === 'CNAME'
      );

      return !!record;
    } catch (error) {
      logger.error('Failed to check DNS record', {
        tenantId,
        subdomain,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Wait for DNS change to propagate
   * @param {string} changeId - Route 53 change ID
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {boolean} - True if change propagated successfully
   */
  async waitForDNSPropagation(changeId, timeoutMs = 300000) { // 5 minutes default
    if (!changeId || !this.enabled) {
      return false;
    }

    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const result = await route53.getChange({ Id: changeId }).promise();
        
        logger.info('DNS change status', {
          changeId,
          status: result.ChangeInfo.Status,
          submittedAt: result.ChangeInfo.SubmittedAt
        });

        if (result.ChangeInfo.Status === 'INSYNC') {
          logger.info('DNS change propagated successfully', { changeId });
          return true;
        }

        // Wait 10 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 10000));
      } catch (error) {
        logger.error('Failed to check DNS change status', {
          changeId,
          error: error.message
        });
        break;
      }
    }

    logger.warn('DNS change propagation timeout', { changeId, timeoutMs });
    return false;
  }

  /**
   * Get all DNS records for the domain
   * @returns {Array} - List of DNS records
   */
  async getAllDNSRecords() {
    if (!this.enabled) {
      return [];
    }

    try {
      const params = {
        HostedZoneId: this.hostedZoneId
      };

      const result = await route53.listResourceRecordSets(params).promise();
      return result.ResourceRecordSets;
    } catch (error) {
      logger.error('Failed to get DNS records', {
        error: error.message,
        hostedZoneId: this.hostedZoneId
      });
      return [];
    }
  }

  /**
   * Validate Route 53 configuration
   * @returns {Object} - Validation result
   */
  async validateConfiguration() {
    const validation = {
      enabled: this.enabled,
      hostedZoneId: this.hostedZoneId,
      domain: this.domain,
      errors: [],
      warnings: []
    };

    if (!this.enabled) {
      validation.warnings.push('Route 53 DNS automation is disabled');
      return validation;
    }

    if (!this.hostedZoneId) {
      validation.errors.push('ROUTE53_HOSTED_ZONE_ID environment variable not set');
    }

    if (!this.domain) {
      validation.errors.push('CUSTOM_DOMAIN_BASE environment variable not set');
    }

    // Test Route 53 access
    try {
      await route53.getHostedZone({ Id: this.hostedZoneId }).promise();
      validation.hostedZoneAccess = true;
    } catch (error) {
      validation.errors.push(`Cannot access hosted zone: ${error.message}`);
      validation.hostedZoneAccess = false;
    }

    return validation;
  }
}

module.exports = DNSService;