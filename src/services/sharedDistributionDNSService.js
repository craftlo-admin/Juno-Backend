const AWS = require('aws-sdk');
const logger = require('../utils/logger');

// Configure AWS Route 53
const route53 = new AWS.Route53({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

/**
 * Shared Distribution DNS Service
 * Manages DNS records for tenants using shared CloudFront distribution
 * All tenant subdomains point to the same shared distribution
 */
class SharedDistributionDNSService {
  
  constructor() {
    this.hostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID;
    this.customDomainBase = process.env.CUSTOM_DOMAIN_BASE || 'junotech.in';
    this.sharedDistributionDomain = process.env.SHARED_CLOUDFRONT_DOMAIN;
    this.enabled = process.env.ROUTE53_ENABLED === 'true';
    
    if (this.enabled && !this.hostedZoneId) {
      logger.warn('Route 53 enabled but ROUTE53_HOSTED_ZONE_ID not set');
    }
    
    if (this.enabled && !this.sharedDistributionDomain) {
      logger.warn('Route 53 enabled but SHARED_CLOUDFRONT_DOMAIN not set');
    }
  }
  
  /**
   * Create DNS CNAME record pointing to shared CloudFront distribution
   * @param {string} tenantId - Tenant identifier
   * @returns {string|null} - Route 53 change ID or null
   */
  async createTenantDNSRecord(tenantId) {
    if (!this.enabled) {
      logger.info('Route 53 DNS automation disabled for shared distribution', { tenantId });
      return null;
    }
    
    if (!this.hostedZoneId) {
      throw new Error('ROUTE53_HOSTED_ZONE_ID environment variable not set');
    }
    
    if (!this.sharedDistributionDomain) {
      throw new Error('SHARED_CLOUDFRONT_DOMAIN environment variable not set');
    }
    
    const subdomain = `${tenantId}.${this.customDomainBase}`;
    
    // Check if DNS record already exists
    const existingRecord = await this.getTenantDNSRecord(tenantId);
    
    if (existingRecord) {
      logger.info('DNS record already exists for tenant on shared distribution', {
        tenantId,
        subdomain,
        currentTarget: existingRecord.target,
        sharedTarget: this.sharedDistributionDomain
      });
      
      // If it points to the correct shared distribution, we're good
      if (existingRecord.target === this.sharedDistributionDomain) {
        logger.info('DNS record already points to shared distribution', {
          tenantId,
          subdomain,
          target: this.sharedDistributionDomain
        });
        return existingRecord.changeId || 'existing-record';
      } else {
        // Update existing record to point to shared distribution
        logger.info('Updating existing DNS record to point to shared distribution', {
          tenantId,
          subdomain,
          oldTarget: existingRecord.target,
          newTarget: this.sharedDistributionDomain
        });
        return await this.updateTenantDNSRecord(tenantId);
      }
    }
    
    // Create new DNS record
    const params = {
      HostedZoneId: this.hostedZoneId,
      ChangeBatch: {
        Comment: `DNS record for tenant ${tenantId} pointing to shared CloudFront distribution`,
        Changes: [{
          Action: 'UPSERT',
          ResourceRecordSet: {
            Name: subdomain,
            Type: 'CNAME',
            TTL: 300, // 5 minutes TTL for faster updates during testing
            ResourceRecords: [{
              Value: this.sharedDistributionDomain
            }]
          }
        }]
      }
    };
    
    try {
      logger.info('Creating DNS record for tenant pointing to shared distribution', {
        tenantId,
        subdomain,
        target: this.sharedDistributionDomain,
        hostedZoneId: this.hostedZoneId
      });
      
      const result = await route53.changeResourceRecordSets(params).promise();
      
      logger.info('DNS record created successfully for shared distribution', {
        tenantId,
        subdomain,
        target: this.sharedDistributionDomain,
        changeId: result.ChangeInfo.Id,
        status: result.ChangeInfo.Status
      });
      
      return result.ChangeInfo.Id;
      
    } catch (error) {
      logger.error('Failed to create DNS record for shared distribution', {
        tenantId,
        subdomain,
        target: this.sharedDistributionDomain,
        error: error.message,
        code: error.code
      });
      
      // Don't throw error - tenant setup should succeed even if DNS fails
      logger.warn('Continuing tenant setup despite DNS failure - tenant will be accessible via CloudFront domain');
      return null;
    }
  }
  
  /**
   * Update existing DNS record to point to shared distribution
   * @param {string} tenantId - Tenant identifier
   * @returns {string|null} - Route 53 change ID or null
   */
  async updateTenantDNSRecord(tenantId) {
    if (!this.enabled) {
      logger.info('Route 53 DNS automation disabled', { tenantId });
      return null;
    }
    
    const subdomain = `${tenantId}.${this.customDomainBase}`;
    
    // Get existing record first to ensure we have the correct format
    const existingRecord = await this.getTenantDNSRecord(tenantId);
    if (!existingRecord) {
      logger.warn('Cannot update DNS record - record not found', { tenantId, subdomain });
      // Create new record instead
      return await this.createTenantDNSRecord(tenantId);
    }
    
    const params = {
      HostedZoneId: this.hostedZoneId,
      ChangeBatch: {
        Comment: `Update DNS record for tenant ${tenantId} to point to shared distribution`,
        Changes: [{
          Action: 'UPSERT',
          ResourceRecordSet: {
            Name: subdomain,
            Type: 'CNAME',
            TTL: 300,
            ResourceRecords: [{
              Value: this.sharedDistributionDomain
            }]
          }
        }]
      }
    };
    
    try {
      logger.info('Updating DNS record to point to shared distribution', {
        tenantId,
        subdomain,
        oldTarget: existingRecord.target,
        newTarget: this.sharedDistributionDomain
      });
      
      const result = await route53.changeResourceRecordSets(params).promise();
      
      logger.info('DNS record updated successfully for shared distribution', {
        tenantId,
        subdomain,
        target: this.sharedDistributionDomain,
        changeId: result.ChangeInfo.Id
      });
      
      return result.ChangeInfo.Id;
      
    } catch (error) {
      logger.error('Failed to update DNS record for shared distribution', {
        tenantId,
        subdomain,
        error: error.message
      });
      return null;
    }
  }
  
  /**
   * Get existing DNS record for tenant
   * @param {string} tenantId - Tenant identifier
   * @returns {Object|null} - DNS record details or null
   */
  async getTenantDNSRecord(tenantId) {
    if (!this.enabled || !this.hostedZoneId) {
      return null;
    }
    
    const subdomain = `${tenantId}.${this.customDomainBase}`;
    
    try {
      const params = {
        HostedZoneId: this.hostedZoneId,
        StartRecordName: subdomain,
        StartRecordType: 'CNAME',
        MaxItems: '1'
      };
      
      const result = await route53.listResourceRecordSets(params).promise();
      
      // Find exact match for our subdomain
      const record = result.ResourceRecordSets.find(r => 
        r.Name === subdomain + '.' && r.Type === 'CNAME'
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
      logger.error('Failed to get DNS record for tenant', {
        tenantId,
        subdomain,
        error: error.message
      });
      return null;
    }
  }
  
  /**
   * Delete DNS record for tenant
   * @param {string} tenantId - Tenant identifier
   * @returns {string|null} - Route 53 change ID or null
   */
  async deleteTenantDNSRecord(tenantId) {
    if (!this.enabled) {
      logger.info('Route 53 DNS automation disabled', { tenantId });
      return null;
    }
    
    const subdomain = `${tenantId}.${this.customDomainBase}`;
    
    // Get existing record to ensure we delete the correct one
    const existingRecord = await this.getTenantDNSRecord(tenantId);
    if (!existingRecord) {
      logger.warn('DNS record not found for deletion', { tenantId, subdomain });
      return null;
    }
    
    const params = {
      HostedZoneId: this.hostedZoneId,
      ChangeBatch: {
        Comment: `Delete DNS record for tenant ${tenantId}`,
        Changes: [{
          Action: 'DELETE',
          ResourceRecordSet: {
            Name: subdomain,
            Type: 'CNAME',
            TTL: existingRecord.ttl,
            ResourceRecords: [{
              Value: existingRecord.target
            }]
          }
        }]
      }
    };
    
    try {
      logger.info('Deleting DNS record for tenant', {
        tenantId,
        subdomain,
        target: existingRecord.target
      });
      
      const result = await route53.changeResourceRecordSets(params).promise();
      
      logger.info('DNS record deleted successfully', {
        tenantId,
        subdomain,
        changeId: result.ChangeInfo.Id
      });
      
      return result.ChangeInfo.Id;
      
    } catch (error) {
      logger.error('Failed to delete DNS record for tenant', {
        tenantId,
        subdomain,
        error: error.message
      });
      return null;
    }
  }
  
  /**
   * Get DNS change status
   * @param {string} changeId - Route 53 change ID
   * @returns {Object|null} - Change status or null
   */
  async getDNSChangeStatus(changeId) {
    if (!this.enabled || !changeId || changeId === 'existing-record') {
      return null;
    }
    
    try {
      const params = { Id: changeId };
      const result = await route53.getChange(params).promise();
      
      return {
        id: result.ChangeInfo.Id,
        status: result.ChangeInfo.Status,
        submittedAt: result.ChangeInfo.SubmittedAt
      };
      
    } catch (error) {
      logger.error('Failed to get DNS change status', {
        changeId,
        error: error.message
      });
      return null;
    }
  }
  
  /**
   * Validate shared distribution DNS configuration
   * @returns {Object} - Validation results
   */
  async validateConfiguration() {
    const validation = {
      enabled: this.enabled,
      hostedZoneConfigured: !!this.hostedZoneId,
      sharedDistributionConfigured: !!this.sharedDistributionDomain,
      customDomainConfigured: !!this.customDomainBase,
      fullyConfigured: false,
      errors: []
    };
    
    if (!this.enabled) {
      validation.errors.push('Route 53 DNS automation is disabled (ROUTE53_ENABLED=false)');
    }
    
    if (this.enabled && !this.hostedZoneId) {
      validation.errors.push('ROUTE53_HOSTED_ZONE_ID environment variable not set');
    }
    
    if (this.enabled && !this.sharedDistributionDomain) {
      validation.errors.push('SHARED_CLOUDFRONT_DOMAIN environment variable not set');
    }
    
    if (!this.customDomainBase) {
      validation.errors.push('CUSTOM_DOMAIN_BASE environment variable not set');
    }
    
    validation.fullyConfigured = this.enabled && 
                                 this.hostedZoneId && 
                                 this.sharedDistributionDomain && 
                                 this.customDomainBase;
    
    if (validation.fullyConfigured) {
      try {
        // Test hosted zone access
        await route53.getHostedZone({ Id: this.hostedZoneId }).promise();
        validation.hostedZoneAccessible = true;
      } catch (error) {
        validation.hostedZoneAccessible = false;
        validation.errors.push(`Cannot access hosted zone: ${error.message}`);
        validation.fullyConfigured = false;
      }
    }
    
    return validation;
  }
  
  /**
   * Generate tenant subdomain
   * @param {string} tenantId - Tenant identifier
   * @returns {string} - Full subdomain
   */
  generateTenantSubdomain(tenantId) {
    return `${tenantId}.${this.customDomainBase}`;
  }
  
  /**
   * Check if DNS service is properly configured
   * @returns {boolean} - Configuration status
   */
  isConfigured() {
    return this.enabled && !!this.hostedZoneId && !!this.sharedDistributionDomain;
  }
}

module.exports = SharedDistributionDNSService;