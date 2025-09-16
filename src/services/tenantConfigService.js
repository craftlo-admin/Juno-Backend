const logger = require('../utils/logger');
const { getPrismaClient } = require('../lib/prisma');

/**
 * Tenant Configuration Service
 * Generates tenant-specific configuration for builds
 */
class TenantConfigService {
  /**
   * Generate tenant-specific configuration
   * @param {string} tenantId - Tenant identifier
   * @param {string} version - Build version
   * @returns {Promise<Object>} - Tenant configuration
   */
  static async generateTenantConfig(tenantId, version) {
    try {
      const prisma = getPrismaClient();
      
      // Get tenant information
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          customDomains: {
            where: { isActive: true }
          },
          settings: true
        }
      });

      if (!tenant) {
        throw new Error(`Tenant not found: ${tenantId}`);
      }

      // Build configuration object
      const config = {
        tenant: {
          id: tenantId,
          name: tenant.name,
          subdomain: tenant.subdomain,
          isActive: tenant.isActive
        },
        version: version,
        deployment: {
          timestamp: new Date().toISOString(),
          baseDomain: process.env.BASE_DOMAIN,
          cdnUrl: process.env.AWS_CLOUDFRONT_URL,
          apiBaseUrl: process.env.API_BASE_URL
        },
        domains: {
          primary: `${tenant.subdomain}.${process.env.BASE_DOMAIN}`,
          custom: tenant.customDomains?.map(domain => domain.domain) || []
        },
        features: {
          analytics: tenant.settings?.analyticsEnabled || false,
          customBranding: tenant.settings?.customBrandingEnabled || false,
          seoOptimization: tenant.settings?.seoOptimizationEnabled || false
        },
        limits: {
          maxFileSize: tenant.settings?.maxFileSize || '10MB',
          maxBandwidth: tenant.settings?.maxBandwidth || '100GB',
          maxPageViews: tenant.settings?.maxPageViews || 50000
        },
        security: {
          enforceHttps: true,
          cspEnabled: tenant.settings?.cspEnabled || false,
          rateLimitEnabled: tenant.settings?.rateLimitEnabled || true
        }
      };

      logger.info('Tenant configuration generated', { tenantId, version });
      return config;

    } catch (error) {
      logger.error('Failed to generate tenant config:', error);
      throw new Error(`Failed to generate tenant configuration: ${error.message}`);
    }
  }

  /**
   * Generate environment variables for build
   * @param {string} tenantId - Tenant identifier
   * @param {string} version - Build version
   * @returns {Promise<Object>} - Environment variables
   */
  static async generateBuildEnvironment(tenantId, version) {
    try {
      const config = await this.generateTenantConfig(tenantId, version);

      return {
        NEXT_PUBLIC_TENANT_ID: tenantId,
        NEXT_PUBLIC_VERSION: version,
        NEXT_PUBLIC_API_BASE_URL: config.deployment.apiBaseUrl,
        NEXT_PUBLIC_CDN_URL: config.deployment.cdnUrl,
        NEXT_PUBLIC_PRIMARY_DOMAIN: config.domains.primary,
        NEXT_PUBLIC_ANALYTICS_ENABLED: config.features.analytics.toString(),
        NEXT_PUBLIC_CUSTOM_BRANDING_ENABLED: config.features.customBranding.toString(),
        NEXT_PUBLIC_SEO_OPTIMIZATION_ENABLED: config.features.seoOptimization.toString(),
        NODE_ENV: 'production'
      };

    } catch (error) {
      logger.error('Failed to generate build environment:', error);
      throw error;
    }
  }
}

module.exports = {
  generateTenantConfig: TenantConfigService.generateTenantConfig.bind(TenantConfigService),
  generateBuildEnvironment: TenantConfigService.generateBuildEnvironment.bind(TenantConfigService)
};